import { randomUUID } from "node:crypto";
import { db, transaction } from "../../packages/platform/db.js";
import { workflowCall } from "../../packages/platform/workflow-client.js";
import { auditEntry } from "../../packages/platform/commands.js";
import { domainOutbox } from "../../packages/platform/events.js";
import { milli, fromMilli } from "../../packages/platform/decimal.js";
import { allocate } from "./pricing.js";

function reserveLines(lines: any[]) {
  const grouped = new Map<string, any>();
  for (const l of lines) {
    const old = grouped.get(l.skuId);
    grouped.set(l.skuId, {
      skuId: l.skuId,
      code: l.code,
      name: l.name,
      baseUnit: l.baseUnit,
      qtyBase: old
        ? fromMilli(milli(old.qtyBase) + milli(l.qtyBase))
        : l.qtyBase,
    });
  }
  return [...grouped.values()].sort((a, b) => a.skuId.localeCompare(b.skuId));
}
async function step(s: any) {
  const d = (
    await db.query("SELECT * FROM orders WHERE tenant_id=$1 AND id=$2", [
      s.tenant_id,
      s.order_id,
    ])
  ).rows[0];
  const ref = {
      tenantId: s.tenant_id,
      orderId: s.order_id,
      reservationId: s.reservation_id,
    },
    pay = {
      ...ref,
      siteId: s.site_id,
      paymentId: s.payment_id,
      shiftId: s.shift_id,
      actorId: s.actor_id,
      orderCode: d.code,
      amountVnd: d.payable_vnd,
      tenderedVnd: s.tendered_vnd,
    };
  let stage = s.stage,
    payment = s.payment,
    stock = s.stock_result,
    status = d.status,
    error: string | null = null;
  if (s.cancel_requested && !["COMMIT", "COMPLETE", "DONE"].includes(stage))
    stage = "CANCEL";
  try {
    if (stage === "RESERVE") {
      const res = await workflowCall("inventory", "reservation/reserve", {
        ...ref,
        siteId: s.site_id,
        warehouseId: d.warehouse_id,
        paymentId: s.payment_id,
        orderCode: d.code,
        actorId: s.actor_id,
        amountVnd: d.payable_vnd,
        lines: reserveLines(d.lines),
      });
      stage = ["ACTIVE", "PREPARED"].includes(res.status)
        ? "PREPARE"
        : res.status === "COMMITTED"
          ? "COMMIT"
          : "CANCEL";
    } else if (stage === "PREPARE") {
      await workflowCall("inventory", "reservation/prepare", {
        ...ref,
        paymentId: s.payment_id,
      });
      stage = "PAYMENT";
    } else if (stage === "PAYMENT") {
      payment = await workflowCall("finance", "payment/create", pay);
      if (payment.status === "SUCCEEDED") {
        stage = "COMMIT";
        status = "COMMITTING";
      } else if (payment.status === "FAILED") stage = "CANCEL";
      else status = "PENDING";
    } else if (stage === "COMMIT") {
      const res = await workflowCall("inventory", "reservation/commit", ref);
      stock = res.result;
      stage = "COMPLETE";
      status = "COMMITTING";
    } else if (stage === "COMPLETE") {
      stage = "DONE";
      status = "COMPLETED";
    } else if (stage === "CANCEL") {
      // A durable FAILED intent also blocks a delayed create after cancellation.
      payment = await workflowCall("finance", "payment/void", pay);
      if (payment.status === "SUCCEEDED") {
        stage = "COMMIT";
        status = "COMMITTING";
      } else {
        try {
          await workflowCall("inventory", "reservation/release", ref);
        } catch (e: any) {
          if (e.getStatus?.() !== 404) throw e;
        }
        stage = "DONE";
        status = "CANCELLED";
      }
    }
  } catch (e: any) {
    const code = e.getStatus?.() ?? 503;
    error = String(
      e.getResponse?.()?.message ?? e.message ?? "Chưa xác định được kết quả.",
    ).slice(0, 500);
    if (
      [400, 403, 404, 409, 422].includes(code) &&
      ["RESERVE", "PREPARE", "PAYMENT"].includes(stage)
    ) {
      stage = "CANCEL";
    }
    status = "REVIEW";
  }
  await transaction(async (c) => {
    // Same order -> saga lock order as user commands; fencing prevents a stale worker write.
    const latest = (
      await c.query(
        "SELECT * FROM orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [s.tenant_id, s.order_id],
      )
    ).rows[0];
    const lease = (
      await c.query("SELECT * FROM checkout_sagas WHERE id=$1 FOR UPDATE", [
        s.id,
      ])
    ).rows[0];
    if (lease.lease_token !== s.lease_token) return;
    let lines = latest.lines;
    if (status === "COMPLETED") {
      lines = structuredClone(lines);
      for (const group of stock) {
        const subset = lines.filter((l: any) => l.skuId === group.skuId),
          values = allocate(
            BigInt(group.costVnd),
            subset.map((l: any) => milli(l.qtyBase)),
          );
        subset.forEach(
          (l: any, i: number) => (l.costVnd = values[i].toString()),
        );
      }
      await domainOutbox(
        c,
        "sales.order-completed.v1",
        s.tenant_id,
        s.site_id,
        s.order_id,
        latest.version + 1,
        {
          orderId: s.order_id,
          orderCode: latest.code,
          paymentId: s.payment_id,
          reservationId: s.reservation_id,
          payableVnd: latest.payable_vnd,
          lines: lines.map((l: any) => ({
            lineId: l.id,
            skuId: l.skuId,
            qtyBase: l.qtyBase,
            netVnd: l.netVnd,
            costVnd: l.costVnd,
          })),
        },
      );
    }
    if (status !== latest.status) {
      await c.query(
        "UPDATE orders SET status=$2,version=version+1,lines=$3,updated_at=clock_timestamp(),completed_at=CASE WHEN $2='COMPLETED' THEN clock_timestamp() ELSE completed_at END,cancel_reason=CASE WHEN $2='CANCELLED' THEN $4 ELSE cancel_reason END WHERE id=$1",
        [
          s.order_id,
          status,
          JSON.stringify(lines),
          lease.cancel_reason ??
            s.last_error ??
            error ??
            "Không thể hoàn tất thanh toán.",
        ],
      );
      await auditEntry(
        c,
        s.tenant_id,
        "service:sales",
        "CHECKOUT_" + status,
        s.order_id,
        { status: latest.status },
        { status, stage },
      );
    }
    const delay = error ? Math.min(30, 2 ** Math.min(s.attempts, 5)) : 1;
    await c.query(
      "UPDATE checkout_sagas SET stage=$2,payment=$3,stock_result=$4,last_error=$5,attempts=$6,next_attempt_at=now()+$7*interval '1 second',lease_token=null,lease_until=null,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
      [
        s.id,
        stage,
        payment ? JSON.stringify(payment) : null,
        stock ? JSON.stringify(stock) : null,
        error,
        error ? s.attempts + 1 : 0,
        delay,
      ],
    );
  });
}
let busy = false;
export async function checkoutTick() {
  if (busy) return;
  busy = true;
  try {
    const rows = await transaction(
      async (c) =>
        (
          await c.query(
            "UPDATE checkout_sagas SET lease_token=$1,lease_until=now()+interval '20 seconds' WHERE id IN (SELECT id FROM checkout_sagas WHERE stage<>'DONE' AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<=now()) ORDER BY next_attempt_at LIMIT 8 FOR UPDATE SKIP LOCKED) RETURNING *",
            [randomUUID()],
          )
        ).rows,
    );
    await Promise.allSettled(
      rows.map((s) =>
        step(s).catch((e) =>
          console.warn(
            "Checkout step will retry:",
            e instanceof Error ? e.message : "unknown",
          ),
        ),
      ),
    );
  } finally {
    busy = false;
  }
}
