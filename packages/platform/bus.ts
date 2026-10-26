import amqp, { type ConfirmChannel, type ChannelModel } from "amqplib";
import type { PoolClient } from "pg";
import { z } from "zod";
import { db, transaction } from "./db.js";
import { setReadiness } from "./http.js";
import { domainEventSchema } from "./events.js";
import { publishConfirmed } from "./publish.js";
const provisionSchema = z.object({
  id: z.uuid(),
  type: z.enum([
    "site.provision.requested",
    "warehouse.ready",
    "register.ready",
    "site.activated",
  ]),
  version: z.literal(1),
  tenantId: z.uuid(),
  siteId: z.uuid(),
  warehouseId: z.uuid(),
  registerId: z.uuid(),
  occurredAt: z.iso.datetime(),
});
const eventSchema = z.union([
  provisionSchema,
  domainEventSchema.transform((e) => ({
    ...e,
    id: e.eventId,
    type: e.eventType,
  })),
]);
export type Event = z.infer<typeof eventSchema>;
export async function worker(
  name: string,
  keys: string[],
  handle: (c: PoolClient, e: Event) => Promise<void>,
) {
  let channel: ConfirmChannel | undefined,
    connection: ChannelModel | undefined,
    busy = false,
    connecting = false;
  setReadiness(() => Boolean(channel));
  const connect = async () => {
    if (connecting || channel) return;
    connecting = true;
    try {
      const link = await amqp.connect(process.env.RABBIT_URL!);
      connection = link;
      link.on("error", () => {});
      link.on("close", () => {
        if (connection === link) channel = undefined;
      });
      const ch = await link.createConfirmChannel();
      ch.on("error", () => {});
      ch.on("close", () => {
        if (channel === ch) channel = undefined;
        void link.close().catch(() => {});
      });
      await ch.assertExchange("storeluma", "topic", { durable: true });
      await ch.assertExchange("storeluma.dead", "fanout", { durable: true });
      for (const [queue, routes] of Object.entries({
        business: ["warehouse.ready", "register.ready"],
        inventory: ["site.provision.requested", "catalog.sku-updated.v1"],
        finance: ["site.provision.requested", "inventory.receipt-posted.v1"],
      })) {
        await ch.assertQueue(queue, {
          durable: true,
          arguments: { "x-dead-letter-exchange": "storeluma.dead" },
        });
        for (const route of routes)
          await ch.bindQueue(queue, "storeluma", route);
      }
      // Keep old queue arguments compatible, but stop cross-service fanout.
      // Failed messages are confirmed into this service's own queue before ack.
      await ch.assertQueue(`${name}.dead`, { durable: true });
      await ch.unbindQueue(`${name}.dead`, "storeluma.dead", "");
      // Retain events whose read-model consumers are scheduled for later weeks.
      await ch.assertQueue("storeluma.deferred", { durable: true });
      for (const route of ["site.activated", "inventory.stock-changed.v1", "sales.order-completed.v1", "finance.payment-succeeded.v1"])
        await ch.bindQueue("storeluma.deferred", "storeluma", route);
      await ch.assertQueue(name, {
        durable: true,
        arguments: { "x-dead-letter-exchange": "storeluma.dead" },
      });
      for (const key of keys) await ch.bindQueue(name, "storeluma", key);
      await ch.prefetch(8);
      const park = async (msg: amqp.ConsumeMessage, reason: string) => {
        try {
          await publishConfirmed(ch, "", `${name}.dead`, msg.content, {
            ...msg.properties,
            headers: {
              ...msg.properties.headers,
              "x-failed-service": name,
              "x-failed-reason": reason,
              "x-original-routing-key":
                msg.properties.headers?.["x-original-routing-key"] ??
                msg.fields.routingKey,
            },
          });
          ch.ack(msg);
        } catch {
          try {
            ch.nack(msg, false, true);
          } catch {}
        }
      };
      await ch.consume(name, async (msg) => {
        if (!msg) {
          void ch.close().catch(() => {});
          return;
        }
        let event: Event;
        try {
          event = eventSchema.parse(JSON.parse(msg.content.toString()));
          if (!keys.includes(event.type)) throw new Error("wrong route");
        } catch {
          await park(msg, "invalid-event");
          return;
        }
        try {
          await transaction(async (c) => {
            const fresh = await c.query(
              "INSERT INTO inbox(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id",
              [event.id],
            );
            if (fresh.rowCount) await handle(c, event);
          });
          ch.ack(msg);
        } catch {
          const rawAttempt = Number(
            msg.properties.headers?.["x-retry-count"] ?? 0,
          );
          const attempt =
            Number.isSafeInteger(rawAttempt) && rawAttempt >= 0
              ? Math.min(rawAttempt, 5)
              : 5;
          console.warn("consumer_retry", {
            service: name,
            eventId: event.id,
            attempt,
          });
          if (attempt >= 5) {
            await park(msg, "retry-exhausted");
            return;
          }
          setTimeout(
            () => {
              void publishConfirmed(ch, "", name, msg.content, {
                ...msg.properties,
                headers: {
                  ...msg.properties.headers,
                  "x-retry-count": attempt + 1,
                  "x-original-routing-key":
                    msg.properties.headers?.["x-original-routing-key"] ??
                    msg.fields.routingKey,
                },
              })
                .then(() => {
                  try {
                    ch.ack(msg);
                  } catch {}
                })
                .catch(() => {
                  try {
                    ch.nack(msg, false, true);
                  } catch {}
                });
            },
            Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250,
          );
        }
      });
      channel = ch;
      console.log(`${name}: broker connected`);
    } catch {
      console.warn(`${name}: broker reconnect pending`);
      try {
        await connection?.close();
      } catch {}
    } finally {
      connecting = false;
    }
  };
  await connect();
  setInterval(async () => {
    if (!channel) {
      await connect();
      return;
    }
    if (busy) return;
    busy = true;
    try {
      const rows = await transaction(
        async (c) =>
          (
            await c.query(
              `UPDATE outbox SET lease_until=now()+interval '15 seconds' WHERE id IN (SELECT id FROM outbox WHERE delivered_at IS NULL AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *`,
            )
          ).rows,
      );
      for (const row of rows) {
        const ch = channel;
        if (!ch) break;
        await publishConfirmed(
          ch,
          "storeluma",
          row.type,
          Buffer.from(JSON.stringify(row.payload)),
          { messageId: row.id },
        );
        await db.query("UPDATE outbox SET delivered_at=now() WHERE id=$1", [
          row.id,
        ]);
      }
    } catch {
      console.warn(`${name}: outbox retry pending`);
    } finally {
      busy = false;
    }
  }, 500);
}
