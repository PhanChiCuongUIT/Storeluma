import {
  Controller,
  Post,
  Body,
  Req,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "../../packages/platform/db.js";
import {
  auditEntry,
  bodyHash,
  moneyInput,
  quantityInput,
} from "../../packages/platform/commands.js";
import { domainOutbox } from "../../packages/platform/events.js";
import {
  verifyWorkflow,
  workflowCall,
} from "../../packages/platform/workflow-client.js";
import type { ActorRequest } from "../../packages/platform/http.js";
import { lockBalance, applyBalance } from "./stock-ledger.js";

const ref = z
  .object({ tenantId: z.uuid(), orderId: z.uuid(), reservationId: z.uuid() })
  .strict();
async function reservation(
  c: Pick<PoolClient, "query">,
  p: z.infer<typeof ref>,
  lock = false,
) {
  const row = (
    await c.query(
      `SELECT * FROM reservations WHERE tenant_id=$1 AND order_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`,
      [p.tenantId, p.orderId, p.reservationId],
    )
  ).rows[0];
  if (!row) throw new NotFoundException("Không tìm thấy lượt giữ hàng.");
  row.lines = (
    await c.query(
      "SELECT * FROM reservation_lines WHERE tenant_id=$1 AND reservation_id=$2 ORDER BY sku_id",
      [p.tenantId, row.id],
    )
  ).rows;
  return row;
}
async function reserveDelta(
  c: PoolClient,
  old: any,
  delta: string,
  source: any,
) {
  const n = (
    await c.query(
      "UPDATE stock_balances SET reserved=reserved+$2::numeric,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *, (on_hand-reserved-quarantined)::text available",
      [old.id, delta],
    )
  ).rows[0];
  await domainOutbox(
    c,
    "inventory.stock-changed.v1",
    n.tenant_id,
    source.site_id,
    n.id,
    n.version,
    {
      warehouseId: n.warehouse_id,
      skuId: n.sku_id,
      onHand: n.on_hand,
      reserved: n.reserved,
      quarantined: n.quarantined,
      available: n.available,
      inventoryValue: n.inventory_value,
      balanceVersion: n.version,
    },
    source.order_id,
  );
}
async function unhold(c: PoolClient, d: any, status: string) {
  for (const line of d.lines) {
    const b = await lockBalance(c, d.tenant_id, d.warehouse_id, line.sku_id);
    await reserveDelta(c, b, "-" + line.qty_base, d);
  }
  await c.query(
    "UPDATE reservations SET status=$2,version=version+1 WHERE id=$1",
    [d.id, status],
  );
  await auditEntry(
    c,
    d.tenant_id,
    "service:sales",
    "RESERVATION_" + status,
    d.id,
    { status: d.status },
    { status, orderId: d.order_id },
  );
}
@Controller("v1/internal/workflows/reservation")
export class Reservations {
  @Post("query") async query(@Req() r: ActorRequest, @Body() b: unknown) {
    await verifyWorkflow(r, ["sales", "finance"]);
    return reservation(db, ref.parse(b));
  }
  @Post("reserve") async reserve(@Req() r: ActorRequest, @Body() b: unknown) {
    await verifyWorkflow(r, ["sales"]);
    const p = ref
      .extend({
        siteId: z.uuid(),
        warehouseId: z.uuid(),
        paymentId: z.uuid(),
        orderCode: z.string().min(1).max(64),
        actorId: z.uuid(),
        amountVnd: moneyInput,
        lines: z
          .array(
            z
              .object({
                skuId: z.uuid(),
                qtyBase: quantityInput,
                code: z.string().max(64),
                name: z.string().max(120),
                baseUnit: z.string().max(30),
              })
              .strict(),
          )
          .min(1)
          .max(100)
          .refine((ls) => new Set(ls.map((l) => l.skuId)).size === ls.length),
      })
      .strict()
      .parse(b);
    return transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "reservation:" + p.tenantId + ":" + p.orderId,
      ]);
      const old = (
        await c.query(
          "SELECT * FROM reservations WHERE tenant_id=$1 AND order_id=$2",
          [p.tenantId, p.orderId],
        )
      ).rows[0];
      if (old) {
        if (old.id !== p.reservationId || old.request_hash !== bodyHash(p))
          throw new ConflictException("Đơn đã dùng lượt giữ khác.");
        return reservation(c, p);
      }
      if (
        !(
          await c.query(
            "SELECT 1 FROM warehouses WHERE tenant_id=$1 AND id=$2 AND site_id=$3",
            [p.tenantId, p.warehouseId, p.siteId],
          )
        ).rowCount
      )
        throw new NotFoundException("Kho không thuộc địa điểm.");
      const balances = [];
      for (const l of [...p.lines].sort((a, b) =>
        a.skuId.localeCompare(b.skuId),
      )) {
        const bal = await lockBalance(c, p.tenantId, p.warehouseId, l.skuId);
        const enough = (
          await c.query(
            "SELECT $1::numeric-$2::numeric-$3::numeric >= $4::numeric ok",
            [bal.on_hand, bal.reserved, bal.quarantined, l.qtyBase],
          )
        ).rows[0].ok;
        if (!enough)
          throw new ConflictException({
            code: "INSUFFICIENT_STOCK",
            message: "Không đủ hàng khả dụng. Chưa thu tiền.",
          });
        balances.push({ bal, l });
      }
      await c.query(
        "INSERT INTO reservations(id,tenant_id,order_id,site_id,warehouse_id,payment_id,order_code,actor_id,request_hash,amount_vnd,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE',now()+interval '120 seconds')",
        [
          p.reservationId,
          p.tenantId,
          p.orderId,
          p.siteId,
          p.warehouseId,
          p.paymentId,
          p.orderCode,
          p.actorId,
          bodyHash(p),
          p.amountVnd,
        ],
      );
      const source = { site_id: p.siteId, order_id: p.orderId };
      for (const { bal, l } of balances) {
        await reserveDelta(c, bal, l.qtyBase, source);
        await c.query(
          "INSERT INTO reservation_lines(id,tenant_id,reservation_id,sku_id,sku_code,sku_name,base_unit,qty_base) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            randomUUID(),
            p.tenantId,
            p.reservationId,
            l.skuId,
            l.code,
            l.name,
            l.baseUnit,
            l.qtyBase,
          ],
        );
      }
      await auditEntry(
        c,
        p.tenantId,
        p.actorId,
        "STOCK_RESERVED",
        p.reservationId,
        null,
        { orderId: p.orderId, lines: p.lines },
      );
      return reservation(c, p);
    });
  }
  @Post("prepare") async prepare(@Req() r: ActorRequest, @Body() b: unknown) {
    await verifyWorkflow(r, ["sales"]);
    const p = ref.extend({ paymentId: z.uuid() }).strict().parse(b);
    const d = await transaction(async (c) => {
      const d = await reservation(c, p, true);
      if (d.payment_id !== p.paymentId)
        throw new ConflictException("Sai tham chiếu thanh toán.");
      if (["PREPARED", "COMMITTED"].includes(d.status)) return d;
      if (d.status !== "ACTIVE") return d;
      if (new Date(d.expires_at).getTime() <= Date.now()) {
        await unhold(c, d, "EXPIRED");
        return { ...d, status: "EXPIRED" };
      }
      await c.query(
        "UPDATE reservations SET status='PREPARED',version=version+1,prepared_at=clock_timestamp() WHERE id=$1",
        [d.id],
      );
      await auditEntry(
        c,
        d.tenant_id,
        "service:sales",
        "RESERVATION_PREPARED",
        d.id,
        { status: "ACTIVE" },
        { status: "PREPARED", paymentId: p.paymentId },
      );
      return reservation(c, p);
    });
    if (!["PREPARED", "COMMITTED"].includes(d.status))
      throw new ConflictException("Lượt giữ hàng đã kết thúc. Chưa thu tiền.");
    return d;
  }
  @Post("commit") async commit(@Req() r: ActorRequest, @Body() b: unknown) {
    await verifyWorkflow(r, ["sales"]);
    const p = ref.parse(b),
      original = await reservation(db, p);
    if (original.status === "COMMITTED") return original;
    const payment = await workflowCall("finance", "payment/query", {
      tenantId: p.tenantId,
      orderId: p.orderId,
      paymentId: original.payment_id,
    });
    if (
      payment.status !== "SUCCEEDED" ||
      payment.reservation_id !== p.reservationId ||
      payment.amount_vnd !== original.amount_vnd ||
      payment.site_id !== original.site_id
    )
      throw new ConflictException("Chưa có xác nhận thu tiền khớp đơn.");
    return transaction(async (c) => {
      const d = await reservation(c, p, true);
      if (d.status === "COMMITTED") return d;
      if (d.status !== "PREPARED")
        throw new ConflictException("Hàng chưa sẵn sàng để xuất.");
      const result = [];
      for (const l of d.lines) {
        let old = await lockBalance(c, d.tenant_id, d.warehouse_id, l.sku_id);
        const v = (
          await c.query(
            "SELECT ($1::numeric-$2::numeric)::text qty,CASE WHEN $1::numeric=$2::numeric THEN $3::numeric ELSE round($3::numeric*$2::numeric/$1::numeric) END::text cost",
            [old.on_hand, l.qty_base, old.inventory_value],
          )
        ).rows[0];
        old = (
          await c.query(
            "UPDATE stock_balances SET reserved=reserved-$2::numeric WHERE id=$1 RETURNING *",
            [old.id, l.qty_base],
          )
        ).rows[0];
        const value = (BigInt(old.inventory_value) - BigInt(v.cost)).toString();
        const next = await applyBalance(
          c,
          old,
          { onHand: v.qty, quarantined: old.quarantined, value },
          {
            kind: "SALE",
            id: d.order_id,
            code: d.order_code,
            line: l,
            siteId: d.site_id,
            reason: "Xuất bán " + d.order_code,
          },
        );
        result.push({
          skuId: l.sku_id,
          qtyBase: l.qty_base,
          costVnd: v.cost,
          onHand: next.on_hand,
        });
      }
      await c.query(
        "UPDATE reservations SET status='COMMITTED',version=version+1,committed_at=clock_timestamp(),result=$2 WHERE id=$1",
        [d.id, JSON.stringify(result)],
      );
      await auditEntry(
        c,
        d.tenant_id,
        "service:sales",
        "STOCK_SALE_COMMITTED",
        d.id,
        { status: d.status },
        { paymentId: d.payment_id, orderId: d.order_id, result },
      );
      return reservation(c, p);
    });
  }
  @Post("release") async release(@Req() r: ActorRequest, @Body() b: unknown) {
    await verifyWorkflow(r, ["sales"]);
    const p = ref.parse(b),
      old = await reservation(db, p);
    if (["RELEASED", "EXPIRED"].includes(old.status)) return old;
    if (old.status === "COMMITTED")
      throw new ConflictException("Đã xuất hàng, không thể bỏ giữ.");
    if (old.status === "PREPARED") {
      const pay = await workflowCall("finance", "payment/query", {
        tenantId: p.tenantId,
        orderId: p.orderId,
        paymentId: old.payment_id,
      });
      if (pay.status !== "FAILED" || pay.reservation_id !== old.id)
        throw new ConflictException("Chưa xác minh được việc ngừng thu tiền.");
    }
    return transaction(async (c) => {
      const d = await reservation(c, p, true);
      if (["RELEASED", "EXPIRED"].includes(d.status)) return d;
      if (
        d.status === "COMMITTED" ||
        (old.status === "ACTIVE" && d.status === "PREPARED")
      )
        throw new ConflictException("Trạng thái giữ hàng đã đổi.");
      await unhold(c, d, "RELEASED");
      return reservation(c, p);
    });
  }
}
let expiring = false;
export async function expireReservations() {
  if (expiring) return;
  expiring = true;
  try {
    const rows = (
      await db.query(
        "SELECT id,tenant_id,order_id FROM reservations WHERE status='ACTIVE' AND expires_at<=now() ORDER BY expires_at LIMIT 20",
      )
    ).rows;
    for (const row of rows)
      await transaction(async (c) => {
        const d = await reservation(
          c,
          {
            tenantId: row.tenant_id,
            orderId: row.order_id,
            reservationId: row.id,
          },
          true,
        );
        if (
          d.status === "ACTIVE" &&
          new Date(d.expires_at).getTime() <= Date.now()
        )
          await unhold(c, d, "EXPIRED");
      });
  } finally {
    expiring = false;
  }
}
