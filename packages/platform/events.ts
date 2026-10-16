import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
const id = z.uuid(),
  amount = z.string().regex(/^\d{1,20}$/),
  qty = z.string().regex(/^\d{1,15}\.\d{3}$/);
const envelope = z.object({
  eventId: id,
  schemaVersion: z.literal(1),
  occurredAt: z.iso.datetime(),
  producer: z.string().max(60),
  tenantId: id,
  siteId: id.nullable(),
  aggregateId: id,
  aggregateType: z.enum(["Sku", "Receipt", "StockBalance"]),
  aggregateVersion: z.number().int().positive(),
  correlationId: id,
  causationId: id,
});
export const domainEventSchema = z.discriminatedUnion("eventType", [
  envelope
    .extend({
      eventType: z.literal("catalog.sku-updated.v1"),
      data: z
        .object({
          skuId: id,
          code: z.string().max(64),
          name: z.string().max(120),
          baseUnit: z.string().max(30),
          status: z.enum(["ACTIVE", "INACTIVE"]),
          version: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  envelope
    .extend({
      eventType: z.literal("inventory.receipt-posted.v1"),
      data: z
        .object({
          receiptId: id,
          sourceType: z.enum(["PURCHASE", "OPENING_STOCK"]),
          supplierId: id.nullable(),
          supplierName: z.string().max(120).nullable(),
          warehouseId: id,
          totalVnd: amount,
          postedAt: z.iso.datetime(),
          lines: z
            .array(
              z
                .object({
                  lineId: id,
                  skuId: id,
                  qtyBase: qty,
                  totalVnd: amount,
                })
                .strict(),
            )
            .min(1)
            .max(100),
        })
        .strict(),
    })
    .strict(),
  envelope
    .extend({
      eventType: z.literal("inventory.stock-changed.v1"),
      data: z
        .object({
          warehouseId: id,
          skuId: id,
          onHand: qty,
          reserved: qty,
          quarantined: qty,
          available: qty,
          inventoryValue: amount,
          balanceVersion: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
]);
export type DomainEvent = z.infer<typeof domainEventSchema>;
export async function domainOutbox(
  c: PoolClient,
  type: DomainEvent["eventType"],
  tenantId: string,
  siteId: string | null,
  aggregateId: string,
  aggregateVersion: number,
  data: unknown,
  correlationId = aggregateId,
) {
  const event = domainEventSchema.parse({
    eventId: randomUUID(),
    eventType: type,
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    producer: process.env.SERVICE_NAME + "-service",
    tenantId,
    siteId,
    aggregateId,
    aggregateType:
      type === "catalog.sku-updated.v1"
        ? "Sku"
        : type === "inventory.receipt-posted.v1"
          ? "Receipt"
          : "StockBalance",
    aggregateVersion,
    correlationId,
    causationId: correlationId,
    data,
  });
  await c.query("INSERT INTO outbox(id,type,payload) VALUES($1,$2,$3)", [
    event.eventId,
    type,
    event,
  ]);
}
