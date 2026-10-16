import {
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SignJWT, decodeJwt, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { bodyHash } from "./commands.js";
import type { ActorRequest } from "./http.js";

export async function verifyService(r: ActorRequest, allowed: string[]) {
  try {
    const token = r.get("x-service-authorization") ?? "",
      untrusted = decodeJwt(token),
      caller = String(untrusted.iss);
    if (!allowed.includes(caller)) throw new Error("caller");
    const key = process.env[`${caller.toUpperCase()}_SERVICE_KEY`];
    if (!key) throw new Error("key");
    const { payload } = await jwtVerify(token, new TextEncoder().encode(key), {
      algorithms: ["HS256"],
      issuer: caller,
      audience: process.env.SERVICE_NAME,
      maxTokenAge: "30s",
    });
    if (
      payload.sub !== r.actor.sub ||
      payload.path !== r.path ||
      payload.method !== r.method ||
      payload.bodyHash !== bodyHash(r.body ?? {})
    )
      throw new Error("binding");
    return caller;
  } catch {
    throw new ForbiddenException("Không xác minh được dịch vụ gọi.");
  }
}
export async function serviceCall<T = any>(
  target: string,
  path: string,
  r: ActorRequest,
  body: unknown,
  method = "POST",
): Promise<T> {
  const caller = process.env.SERVICE_NAME!,
    key = process.env[`${caller.toUpperCase()}_SERVICE_KEY`];
  if (!key)
    throw new ServiceUnavailableException("Chưa cấu hình kết nối dịch vụ.");
  const token = await new SignJWT({
    path,
    method,
    bodyHash: bodyHash(body ?? {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(caller)
    .setAudience(target)
    .setSubject(r.actor.sub!)
    .setIssuedAt()
    .setExpirationTime("30s")
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(key));
  let response: Response;
  try {
    response = await fetch(
      `${process.env[`${target.toUpperCase()}_URL`] ?? `http://${target}:4100`}${path}`,
      {
        method,
        headers: {
          authorization: r.headers.authorization!,
          "x-service-authorization": token,
          "content-type": "application/json",
        },
        body: method === "GET" ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(method === "GET" ? 3000 : 5000),
      },
    );
  } catch {
    throw new ServiceUnavailableException(
      "Dịch vụ liên quan đang gián đoạn. Giữ nguyên mã thao tác để thử lại.",
    );
  }
  const result = await response.json();
  if (!response.ok)
    throw new HttpException(
      result.message ?? "Dịch vụ liên quan từ chối yêu cầu.",
      response.status,
    );
  return result as T;
}
export type Grant = {
  role: string;
  siteIds: string[];
  warehouseId?: string;
  siteName?: string;
  costRead: boolean;
  permissionVersion: number;
};
export function authorize(
  r: ActorRequest,
  tenantId: string,
  action: string,
  siteId?: string,
) {
  return serviceCall<Grant>("business", "/v1/internal/authorize", r, {
    tenantId,
    action,
    ...(siteId ? { siteId } : {}),
  });
}
