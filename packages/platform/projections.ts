import {
  Body,
  Controller,
  ForbiddenException,
  GoneException,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SignJWT, decodeJwt, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { db, transaction } from "./db.js";
import { bodyHash } from "./commands.js";
import type { ActorRequest } from "./http.js";
import type { Event } from "./bus.js";

export const projectionProducers = [
  "catalog",
  "inventory",
  "sales",
  "finance",
] as const;
export const projectionRoutes = projectionProducers.map(
  (p) => p + ".projection-updated.v1",
);
const kinds: Record<string, string[]> = {
  catalog: ["SKU"],
  inventory: ["STOCK"],
  sales: ["ORDER", "RETURN"],
  finance: ["MONEY", "SHIFT", "PAYMENT", "REFUND"],
};
const integer = z.string().regex(/^-?\d{1,30}$/),
  decimal = z.string().regex(/^-?\d{1,18}(\.\d{1,3})?$/),
  timestamp = z.iso.datetime({ offset: true });
const line = z
  .object({
    skuId: z.uuid(),
    code: z.string(),
    name: z.string(),
    qtyBase: decimal,
    costVnd: integer.optional(),
    netVnd: integer.optional(),
    refundVnd: integer.optional(),
  })
  .passthrough();
const documentFields = {
  code: z.string(),
  status: z.string(),
  actorId: z.string(),
  lines: z.array(line),
  amountVnd: integer,
  createdAt: timestamp,
  completedAt: timestamp.nullable(),
};
const dataSchemas: Record<string, z.ZodType> = {
  SKU: z
    .object({
      code: z.string(),
      name: z.string(),
      baseUnit: z.string(),
      status: z.string(),
    })
    .passthrough(),
  STOCK: z
    .object({
      warehouseId: z.uuid(),
      skuId: z.uuid(),
      onHand: decimal,
      reserved: decimal,
      quarantined: decimal,
      available: decimal,
      valueVnd: integer,
      updatedAt: timestamp,
    })
    .passthrough(),
  ORDER: z
    .object({ ...documentFields, subtotalVnd: integer, discountVnd: integer })
    .passthrough(),
  RETURN: z.object({ ...documentFields, orderId: z.uuid() }).passthrough(),
  MONEY: z
    .object({
      shiftId: z.uuid(),
      actorId: z.string(),
      kind: z.enum(["PAYMENT", "REFUND", "CASH_ENTRY"]),
      sourceId: z.uuid(),
      amountVnd: integer,
      occurredAt: timestamp,
    })
    .passthrough(),
  SHIFT: z
    .object({
      actorId: z.string(),
      status: z.string(),
      openingVnd: integer,
      expectedVnd: integer.nullable(),
      countedVnd: integer.nullable(),
      differenceVnd: integer.nullable(),
      approvedAt: timestamp.nullable(),
      openedAt: timestamp,
      closedAt: timestamp.nullable(),
    })
    .passthrough(),
  PAYMENT: z
    .object({
      actorId: z.string(),
      orderId: z.uuid(),
      code: z.string(),
      status: z.string(),
      amountVnd: integer,
      shiftId: z.uuid(),
      createdAt: timestamp,
    })
    .passthrough(),
  REFUND: z
    .object({
      actorId: z.string().nullable(),
      returnId: z.uuid(),
      orderId: z.uuid(),
      status: z.string(),
      amountVnd: integer,
      shiftId: z.uuid().nullable(),
      createdAt: timestamp,
    })
    .passthrough(),
};
export const projectionRecordSchema = z
  .object({
    kind: z.enum([
      "SKU",
      "STOCK",
      "ORDER",
      "RETURN",
      "MONEY",
      "SHIFT",
      "PAYMENT",
      "REFUND",
    ]),
    id: z.uuid(),
    tenantId: z.uuid(),
    siteId: z.uuid().nullable(),
    revision: z.number().int().positive(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (!dataSchemas[p.kind].safeParse(p.data).success)
      ctx.addIssue({
        code: "custom",
        message: "Invalid projection data",
        path: ["data"],
      });
    if (["ORDER", "RETURN"].includes(p.kind) && p.data.status === "COMPLETED") {
      if (
        !p.data.completedAt ||
        !(p.data.lines as any[])?.every(
          (l) =>
            integer.safeParse(l.costVnd).success &&
            integer.safeParse(l[p.kind === "ORDER" ? "netVnd" : "refundVnd"])
              .success,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Incomplete settled document",
          path: ["data"],
        });
    }
  });
type Projection = z.infer<typeof projectionRecordSchema>;

/** Purpose-separated credentials cannot be used for checkout commands or user APIs. */
export async function verifyProjectionCaller(r: ActorRequest) {
  try {
    const token = r.get("x-projection-authorization") ?? "",
      caller = String(decodeJwt(token).iss);
    if (!["reporting", "notification"].includes(caller))
      throw new Error("caller");
    const key = process.env[caller.toUpperCase() + "_SERVICE_KEY"];
    if (!key) throw new Error("key");
    const { payload } = await jwtVerify(token, new TextEncoder().encode(key), {
      algorithms: ["HS256"],
      issuer: caller,
      audience: process.env.SERVICE_NAME,
      maxTokenAge: "30s",
    });
    if (
      payload.purpose !== "read-model-snapshot" ||
      payload.path !== r.path ||
      payload.method !== r.method ||
      payload.bodyHash !== bodyHash(r.body ?? {})
    )
      throw new Error("binding");
    return caller;
  } catch {
    throw new ForbiddenException("Không xác minh được yêu cầu đồng bộ.");
  }
}

@Controller("v1/internal/projections")
export class ProjectionSource {
  @Post("snapshot") async snapshot(
    @Req() r: ActorRequest,
    @Body() raw: unknown,
  ) {
    const consumer = await verifyProjectionCaller(r),
      p = z
        .object({
          snapshotId: z.uuid().optional(),
          offset: z.number().int().min(0).max(10000000).default(0),
        })
        .strict()
        .parse(raw);
    return transaction(async (c) => {
      // One SQL statement captures a consistent cohort; subsequent pages read it unchanged.
      let id = p.snapshotId;
      if (!id) {
        id = randomUUID();
        await c.query(
          "DELETE FROM projection_snapshots WHERE expires_at<now()",
        );
        await c.query(
          `INSERT INTO projection_snapshots(id,consumer,as_of,records,expires_at)
          SELECT $1,$2,statement_timestamp(),COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'tenantId',tenant_id,'siteId',site_id,'revision',revision,'data',data) ORDER BY kind,id),'[]'),now()+interval '1 hour' FROM projection_records`,
          [id, consumer],
        );
      }
      const snap = (
        await c.query(
          `SELECT id,as_of,jsonb_array_length(records) total,
        COALESCE((SELECT jsonb_agg(value ORDER BY ord) FROM jsonb_array_elements(records) WITH ORDINALITY v(value,ord) WHERE ord>$3 AND ord<=$3+250),'[]') items
        FROM projection_snapshots WHERE id=$1 AND consumer=$2 AND expires_at>now()`,
          [id, consumer, p.offset],
        )
      ).rows[0];
      if (!snap) throw new GoneException("Phiên đồng bộ đã hết hạn.");
      return {
        snapshotId: id,
        asOf: snap.as_of,
        items: snap.items,
        nextOffset: p.offset + snap.items.length,
        total: snap.total,
        done: p.offset + snap.items.length >= snap.total,
      };
    });
  }
}

async function fetchSnapshot(producer: string, body: unknown) {
  const caller = process.env.SERVICE_NAME!,
    key = process.env[caller.toUpperCase() + "_SERVICE_KEY"];
  if (!key) throw new Error("Snapshot credentials missing");
  const path = "/v1/internal/projections/snapshot";
  const token = await new SignJWT({
    purpose: "read-model-snapshot",
    path,
    method: "POST",
    bodyHash: bodyHash(body),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(caller)
    .setAudience(producer)
    .setIssuedAt()
    .setExpirationTime("30s")
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(key));
  const response = await fetch(
    (process.env[producer.toUpperCase() + "_URL"] ??
      `http://${producer}:4100`) + path,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-projection-authorization": token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) {
    const e = new Error("Snapshot unavailable") as Error & {
      expired?: boolean;
    };
    e.expired = response.status === 410;
    throw e;
  }
  return z
    .object({
      snapshotId: z.uuid(),
      asOf: z.iso.datetime({ offset: true }),
      items: z.array(projectionRecordSchema).max(250),
      nextOffset: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      done: z.boolean(),
    })
    .strict()
    .parse(await response.json());
}

export async function applyProjection(
  c: PoolClient,
  producer: string,
  raw: Projection,
) {
  const p = projectionRecordSchema.parse(raw);
  if (
    !kinds[producer]?.includes(p.kind) ||
    (p.kind === "SKU") !== (p.siteId === null)
  )
    throw new Error("Projection source mismatch");
  const previous = (
    await c.query(
      "SELECT tenant_id,site_id FROM read_records WHERE producer=$1 AND kind=$2 AND id=$3",
      [producer, p.kind, p.id],
    )
  ).rows[0];
  if (
    previous &&
    (previous.tenant_id !== p.tenantId || previous.site_id !== p.siteId)
  )
    throw new Error("Projection identity conflict");
  await c.query(
    `INSERT INTO read_records(producer,kind,id,tenant_id,site_id,revision,data) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(producer,kind,id) DO UPDATE SET revision=excluded.revision,data=excluded.data,applied_at=clock_timestamp()
    WHERE read_records.revision<excluded.revision
      AND read_records.tenant_id=excluded.tenant_id
      AND read_records.site_id IS NOT DISTINCT FROM excluded.site_id`,
    [producer, p.kind, p.id, p.tenantId, p.siteId, p.revision, p.data],
  );
  // Also check after UPSERT: another transaction may insert the ID after our first read.
  const stored = (
    await c.query(
      "SELECT tenant_id,site_id FROM read_records WHERE producer=$1 AND kind=$2 AND id=$3",
      [producer, p.kind, p.id],
    )
  ).rows[0];
  if (stored.tenant_id !== p.tenantId || stored.site_id !== p.siteId)
    throw new Error("Projection identity conflict");
}
export async function consumeProjection(c: PoolClient, event: Event) {
  if (!("data" in event) || !event.eventType.endsWith(".projection-updated.v1"))
    throw new Error("Unexpected projection event");
  const producer = event.eventType.split(".")[0];
  if (
    event.producer !== producer + "-service" ||
    event.aggregateType !== "Projection"
  )
    throw new Error("Unexpected producer");
  const data = event.data as {
    kind: Projection["kind"];
    record: Record<string, unknown>;
  };
  await applyProjection(c, producer, {
    kind: data.kind,
    id: event.aggregateId,
    tenantId: event.tenantId,
    siteId: event.siteId,
    revision: event.aggregateVersion,
    data: data.record,
  });
}

/** Each consumer owns its checkpoints. Leases do not hold SQL transactions over HTTP. */
export async function syncProjectionTick() {
  const token = randomUUID();
  const state = (
    await db.query(
      `UPDATE projection_sync SET lease_token=$1,lease_until=now()+interval '30 seconds'
    WHERE producer=(SELECT producer FROM projection_sync WHERE next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at,producer LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
      [token],
    )
  ).rows[0];
  if (!state) return;
  try {
    const page = await fetchSnapshot(state.producer, {
      ...(state.snapshot_id ? { snapshotId: state.snapshot_id } : {}),
      offset: state.offset_value,
    });
    await transaction(async (c) => {
      const lease = await c.query(
        "SELECT 1 FROM projection_sync WHERE producer=$1 AND lease_token=$2 FOR UPDATE",
        [state.producer, token],
      );
      if (!lease.rowCount) return;
      for (const record of page.items)
        await applyProjection(c, state.producer, record);
      await c.query(
        `UPDATE projection_sync SET snapshot_id=$3,offset_value=$4,as_of=CASE WHEN $5 THEN $6::timestamptz ELSE as_of END,
        next_attempt_at=CASE WHEN $5 THEN now()+interval '5 minutes' ELSE now() END,last_error=NULL,lease_token=NULL,lease_until=NULL
        WHERE producer=$1 AND lease_token=$2`,
        [
          state.producer,
          token,
          page.done ? null : page.snapshotId,
          page.done ? 0 : page.nextOffset,
          page.done,
          page.asOf,
        ],
      );
    });
  } catch (error) {
    await db.query(
      `UPDATE projection_sync SET last_error='SOURCE_UNAVAILABLE',next_attempt_at=now()+interval '10 seconds',
      snapshot_id=CASE WHEN $3 THEN NULL ELSE snapshot_id END,offset_value=CASE WHEN $3 THEN 0 ELSE offset_value END,lease_token=NULL,lease_until=NULL WHERE producer=$1 AND lease_token=$2`,
      [
        state.producer,
        token,
        Boolean((error as { expired?: boolean }).expired),
      ],
    );
  }
}
export async function projectionFreshness(c: Pick<PoolClient, "query"> = db) {
  const sources = (
    await c.query(
      "SELECT producer,as_of,last_error FROM projection_sync ORDER BY producer",
    )
  ).rows;
  const complete = sources.length === 4 && sources.every((s) => s.as_of);
  const asOf = complete
    ? new Date(
        Math.min(...sources.map((s) => new Date(s.as_of).getTime())),
      ).toISOString()
    : null;
  return {
    dataAsOf: asOf,
    initializing: !complete,
    stale:
      !complete ||
      sources.some((s) => s.last_error) ||
      Date.now() - Date.parse(asOf!) > 600000,
    sources,
  };
}
export async function requireProjectionReady() {
  const status = await projectionFreshness();
  if (status.initializing)
    throw new ServiceUnavailableException(
      "Đang tổng hợp dữ liệu ban đầu. Vui lòng thử lại sau.",
    );
  return status;
}
