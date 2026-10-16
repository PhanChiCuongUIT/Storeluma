import { ConflictException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";

export const nameInput = z.string().trim().min(1).max(120);
export const codeInput = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_-]{2,64}$/);
export const moneyInput = z.string().regex(/^(0|[1-9]\d{0,19})$/);
export const quantityInput = z
  .string()
  .regex(/^(0|[1-9]\d{0,14})(\.\d{1,3})?$/)
  .refine((s) => /[1-9]/.test(s), "Số lượng phải lớn hơn 0.");
export const versionInput = z.number().int().positive();
export const statusInput = z.enum(["ACTIVE", "INACTIVE"]);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const bodyHash = (body: unknown) =>
  createHash("sha256").update(canonical(body)).digest("hex");
export async function idempotent<T>(
  c: PoolClient,
  scope: string,
  key: string,
  body: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  z.string()
    .regex(/^[A-Za-z0-9_-]{16,64}$/)
    .parse(key);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    scope + ":" + key,
  ]);
  const hash = bodyHash(body),
    old = (
      await c.query("SELECT * FROM idempotency WHERE scope=$1 AND key=$2", [
        scope,
        key,
      ])
    ).rows[0];
  if (old) {
    if (old.body_hash !== hash)
      throw new ConflictException("Mã thao tác đã dùng với nội dung khác.");
    return old.response;
  }
  const response = await fn();
  await c.query(
    "INSERT INTO idempotency(scope,key,body_hash,response) VALUES($1,$2,$3,$4)",
    [scope, key, hash, response],
  );
  return response;
}
export async function auditEntry(
  c: PoolClient,
  tenant: string,
  actor: string,
  action: string,
  id: string,
  before: unknown,
  after: unknown,
) {
  await c.query(
    "INSERT INTO audit(id,tenant_id,actor,action,entity_id,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [randomUUID(), tenant, actor, action, id, before, after],
  );
}
export function pageInput(query: Record<string, unknown>) {
  return z
    .object({
      q: z.string().trim().max(120).default(""),
      status: statusInput.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: z.uuid().optional(),
    })
    .strict()
    .parse(query);
}
export function pageResult(rows: any[], limit: number) {
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}
