import {
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SignJWT, decodeJwt, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { bodyHash } from "./commands.js";
import type { ActorRequest } from "./http.js";

/** Machine commands are confined to admitted checkout workflows. Never a browser identity. */
export async function verifyWorkflow(r: ActorRequest, allowed: string[]) {
  try {
    const token = r.get("x-workflow-authorization") ?? "";
    const issuer = String(decodeJwt(token).iss);
    if (!allowed.includes(issuer)) throw new Error("caller");
    const key = process.env[issuer.toUpperCase() + "_SERVICE_KEY"];
    if (!key) throw new Error("key");
    const { payload } = await jwtVerify(token, new TextEncoder().encode(key), {
      issuer,
      audience: process.env.SERVICE_NAME,
      algorithms: ["HS256"],
      maxTokenAge: "30s",
    });
    if (
      payload.purpose !== "checkout-workflow" ||
      payload.method !== r.method ||
      payload.path !== r.path ||
      payload.bodyHash !== bodyHash(r.body ?? {}) ||
      typeof r.body?.tenantId !== "string" ||
      payload.tenantId !== r.body.tenantId
    )
      throw new Error("binding");
    return issuer;
  } catch {
    throw new ForbiddenException("Không xác minh được lệnh xử lý giao dịch.");
  }
}

export async function workflowCall<T = any>(
  target: string,
  resource: string,
  body: Record<string, unknown>,
): Promise<T> {
  const caller = process.env.SERVICE_NAME!,
    key = process.env[caller.toUpperCase() + "_SERVICE_KEY"];
  if (!key)
    throw new ServiceUnavailableException(
      "Chưa cấu hình dịch vụ xử lý giao dịch.",
    );
  const path = "/v1/internal/workflows/" + resource;
  const token = await new SignJWT({
    purpose: "checkout-workflow",
    tenantId: body.tenantId,
    method: "POST",
    path,
    bodyHash: bodyHash(body),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(caller)
    .setAudience(target)
    .setIssuedAt()
    .setExpirationTime("30s")
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(key));
  let response: Response;
  try {
    response = await fetch(
      `${process.env[target.toUpperCase() + "_URL"] ?? `http://${target}:4100`}${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workflow-authorization": token,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch {
    throw new ServiceUnavailableException(
      "Chưa liên lạc được dịch vụ liên quan. Giao dịch sẽ tiếp tục với mã hiện tại.",
    );
  }
  let result: any;
  try {
    result = await response.json();
  } catch {
    throw new ServiceUnavailableException("Chưa xác định được kết quả xử lý.");
  }
  if (!response.ok) throw new HttpException(result, response.status);
  return result;
}
