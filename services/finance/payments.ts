import {
  Controller,
  Get,
  Post,
  Req,
  Param,
  Query,
  Body,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "../../packages/platform/db.js";
import { authorize } from "../../packages/platform/service-client.js";
import {
  verifyWorkflow,
  workflowCall,
} from "../../packages/platform/workflow-client.js";
import {
  moneyInput,
  versionInput,
  idempotent,
  auditEntry,
} from "../../packages/platform/commands.js";
import { domainOutbox } from "../../packages/platform/events.js";
import type { ActorRequest } from "../../packages/platform/http.js";

const intent = z
  .object({
    tenantId: z.uuid(),
    siteId: z.uuid(),
    orderId: z.uuid(),
    reservationId: z.uuid(),
    paymentId: z.uuid(),
    shiftId: z.uuid(),
    actorId: z.uuid(),
    orderCode: z.string().min(1).max(64),
    amountVnd: moneyInput,
    tenderedVnd: moneyInput,
  })
  .strict();
async function payment(
  c: any,
  p: { tenantId: string; paymentId: string; orderId: string },
) {
  const d = (
    await c.query(
      "SELECT * FROM payments WHERE tenant_id=$1 AND id=$2 AND order_id=$3",
      [p.tenantId, p.paymentId, p.orderId],
    )
  ).rows[0];
  if (!d) throw new NotFoundException("Chưa có yêu cầu thu tiền.");
  return d;
}
function matches(d: any, p: z.infer<typeof intent>) {
  if (
    d.id !== p.paymentId ||
    d.site_id !== p.siteId ||
    d.order_id !== p.orderId ||
    d.reservation_id !== p.reservationId ||
    d.shift_id !== p.shiftId ||
    d.actor_id !== p.actorId ||
    d.order_code !== p.orderCode ||
    d.amount_vnd !== p.amountVnd ||
    d.tendered_vnd !== p.tenderedVnd
  )
    throw new ConflictException("Tham chiếu thu tiền không khớp.");
}
function cashier(d: any, r: ActorRequest, role: string) {
  if (role === "CASHIER" && d.cashier_id !== r.actor.sub)
    throw new ForbiddenException("Ca này do người khác mở.");
}
@Controller("v1")
export class Payments {
  @Get("tenants/:tenant/shifts") async shifts(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: unknown,
  ) {
    const p = z.object({ siteId: z.uuid() }).strict().parse(q);
    await authorize(r, t, "shift.read", p.siteId);
    return {
      items: (
        await db.query(
          "SELECT s.*, (s.opening_cash+COALESCE((SELECT sum(l.amount_vnd) FROM cash_ledger l WHERE l.tenant_id=s.tenant_id AND l.shift_id=s.id),0))::text AS expected_now FROM shifts s WHERE tenant_id=$1 AND site_id=$2 ORDER BY opened_at DESC LIMIT 50",
          [t, p.siteId],
        )
      ).rows,
    };
  }
  @Post("tenants/:tenant/shifts") async open(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Body() b: unknown,
  ) {
    const p = z
        .object({ siteId: z.uuid(), openingCash: moneyInput })
        .strict()
        .parse(b),
      g = await authorize(r, t, "shift.open", p.siteId);
    return transaction((c) =>
      idempotent(
        c,
        t + ":shift-open:" + r.actor.sub,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          await c.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["register:" + g.registerId],
          );
          if (
            (
              await c.query(
                "SELECT 1 FROM shifts WHERE tenant_id=$1 AND register_id=$2 AND status='OPEN'",
                [t, g.registerId],
              )
            ).rowCount
          )
            throw new ConflictException("Quầy đang có ca mở.");
          const d = (
            await c.query(
              "INSERT INTO shifts(id,tenant_id,site_id,register_id,cashier_id,opening_cash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
              [
                randomUUID(),
                t,
                p.siteId,
                g.registerId,
                r.actor.sub,
                p.openingCash,
              ],
            )
          ).rows[0];
          await auditEntry(c, t, r.actor.sub!, "SHIFT_OPENED", d.id, null, d);
          return d;
        },
      ),
    );
  }
  @Post("tenants/:tenant/shifts/:id/close") async close(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    z.uuid().parse(id);
    const p = z
        .object({
          siteId: z.uuid(),
          version: versionInput,
          countedCash: moneyInput,
          note: z.string().trim().max(500).default(""),
        })
        .strict()
        .parse(b),
      g = await authorize(r, t, "shift.close", p.siteId);
    return transaction((c) =>
      idempotent(
        c,
        t + ":shift-close:" + id,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          const d = (
            await c.query(
              "SELECT * FROM shifts WHERE tenant_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE",
              [t, p.siteId, id],
            )
          ).rows[0];
          if (!d) throw new NotFoundException();
          cashier(d, r, g.role);
          if (d.status !== "OPEN" || d.version !== p.version)
            throw new ConflictException("Ca đã thay đổi.");
          if (
            (
              await c.query(
                "SELECT 1 FROM payments WHERE tenant_id=$1 AND shift_id=$2 AND status='PENDING'",
                [t, id],
              )
            ).rowCount
          )
            throw new ConflictException(
              "Còn đơn chờ thu tiền. Hoàn tất hoặc hủy trước khi đóng ca.",
            );
          const total = (
            await c.query(
              "SELECT COALESCE(sum(amount_vnd),0)::text value FROM cash_ledger WHERE tenant_id=$1 AND shift_id=$2",
              [t, id],
            )
          ).rows[0].value;
          const expected = BigInt(d.opening_cash) + BigInt(total),
            diff = BigInt(p.countedCash) - expected;
          if (diff !== 0n && !p.note)
            throw new ConflictException("Cần ghi lý do chênh lệch tiền.");
          const n = (
            await c.query(
              "UPDATE shifts SET status='CLOSED',version=version+1,expected_cash=$2,counted_cash=$3,difference_vnd=$4,close_note=$5,closed_at=clock_timestamp() WHERE id=$1 RETURNING *",
              [id, expected.toString(), p.countedCash, diff.toString(), p.note],
            )
          ).rows[0];
          await auditEntry(c, t, r.actor.sub!, "SHIFT_CLOSED", id, d, n);
          return n;
        },
      ),
    );
  }
  @Post("internal/shifts/validate") async validate(
    @Req() r: ActorRequest,
    @Body() b: unknown,
  ) {
    const { verifyService } =
      await import("../../packages/platform/service-client.js");
    await verifyService(r, ["sales"]);
    const p = z
        .object({ tenantId: z.uuid(), siteId: z.uuid(), shiftId: z.uuid() })
        .strict()
        .parse(b),
      g = await authorize(r, p.tenantId, "sale.checkout", p.siteId);
    const d = (
      await db.query(
        "SELECT * FROM shifts WHERE tenant_id=$1 AND site_id=$2 AND id=$3 AND status='OPEN'",
        [p.tenantId, p.siteId, p.shiftId],
      )
    ).rows[0];
    if (!d) throw new ConflictException("Mở ca thu ngân trước khi thanh toán.");
    cashier(d, r, g.role);
    return { id: d.id, status: d.status };
  }
  @Post("internal/workflows/payment/query") async query(
    @Req() r: ActorRequest,
    @Body() b: unknown,
  ) {
    await verifyWorkflow(r, ["sales", "inventory"]);
    return payment(
      db,
      z
        .object({ tenantId: z.uuid(), orderId: z.uuid(), paymentId: z.uuid() })
        .strict()
        .parse(b),
    );
  }
  @Post("internal/workflows/payment/create") async create(
    @Req() r: ActorRequest,
    @Body() b: unknown,
  ) {
    await verifyWorkflow(r, ["sales"]);
    const p = intent.parse(b);
    if (BigInt(p.tenderedVnd) < BigInt(p.amountVnd))
      throw new ConflictException("Tiền khách đưa chưa đủ.");
    const old = (
      await db.query(
        "SELECT * FROM payments WHERE tenant_id=$1 AND order_id=$2",
        [p.tenantId, p.orderId],
      )
    ).rows[0];
    if (old) {
      matches(old, p);
      return old;
    }
    const res = await workflowCall("inventory", "reservation/query", {
      tenantId: p.tenantId,
      orderId: p.orderId,
      reservationId: p.reservationId,
    });
    if (
      res.status !== "PREPARED" ||
      res.payment_id !== p.paymentId ||
      res.amount_vnd !== p.amountVnd ||
      res.site_id !== p.siteId
    )
      throw new ConflictException("Hàng chưa được giữ chắc chắn cho đơn.");
    return this.storeIntent(p, false);
  }
  @Post("internal/workflows/payment/void") async void(
    @Req() r: ActorRequest,
    @Body() b: unknown,
  ) {
    await verifyWorkflow(r, ["sales"]);
    return this.storeIntent(intent.parse(b), true);
  }
  private async storeIntent(p: z.infer<typeof intent>, voided: boolean) {
    return transaction(async (c) => {
      // All cash transitions lock shift before payment, including cancellation.
      const shift = (
        await c.query(
          "SELECT * FROM shifts WHERE tenant_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE",
          [p.tenantId, p.siteId, p.shiftId],
        )
      ).rows[0];
      if (!shift) throw new NotFoundException("Không tìm thấy ca.");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "payment:" + p.tenantId + ":" + p.orderId,
      ]);
      const old = (
        await c.query(
          "SELECT * FROM payments WHERE tenant_id=$1 AND order_id=$2 FOR UPDATE",
          [p.tenantId, p.orderId],
        )
      ).rows[0];
      if (old) {
        matches(old, p);
        if (!voided || old.status !== "PENDING") return old;
        await c.query(
          "UPDATE payments SET status='FAILED',version=version+1 WHERE id=$1",
          [old.id],
        );
      } else {
        if (!voided && shift.status !== "OPEN")
          throw new ConflictException("Ca đã đóng. Chưa thu tiền.");
        await c.query(
          "INSERT INTO payments(id,tenant_id,site_id,order_id,reservation_id,shift_id,actor_id,order_code,amount_vnd,tendered_vnd,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            p.paymentId,
            p.tenantId,
            p.siteId,
            p.orderId,
            p.reservationId,
            p.shiftId,
            p.actorId,
            p.orderCode,
            p.amountVnd,
            p.tenderedVnd,
            voided ? "FAILED" : "PENDING",
          ],
        );
      }
      const n = await payment(c, p);
      await auditEntry(
        c,
        p.tenantId,
        "service:sales",
        voided ? "PAYMENT_VOIDED" : "PAYMENT_CREATED",
        p.paymentId,
        old ?? null,
        n,
      );
      return n;
    });
  }
  @Post("tenants/:tenant/payments/:id/confirm") async confirm(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    z.uuid().parse(id);
    const p = z
        .object({
          siteId: z.uuid(),
          version: versionInput,
          cashReceived: z.literal(true),
        })
        .strict()
        .parse(b),
      g = await authorize(r, t, "payment.confirm", p.siteId);
    const d = (
      await db.query(
        "SELECT * FROM payments WHERE tenant_id=$1 AND site_id=$2 AND id=$3",
        [t, p.siteId, id],
      )
    ).rows[0];
    if (!d) throw new NotFoundException();
    return transaction((c) =>
      idempotent(
        c,
        t + ":cash-confirm:" + id,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          const shift = (
            await c.query(
              "SELECT * FROM shifts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [t, d.shift_id],
            )
          ).rows[0];
          cashier(shift, r, g.role);
          const old = (
            await c.query(
              "SELECT * FROM payments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [t, id],
            )
          ).rows[0];
          if (old.status === "SUCCEEDED") return old;
          if (
            shift.status !== "OPEN" ||
            old.status !== "PENDING" ||
            old.version !== p.version
          )
            throw new ConflictException("Yêu cầu thu tiền đã thay đổi.");
          const n = (
            await c.query(
              "UPDATE payments SET status='SUCCEEDED',version=version+1,confirmed_by=$2,confirmed_at=clock_timestamp() WHERE id=$1 RETURNING *",
              [id, r.actor.sub],
            )
          ).rows[0];
          await c.query(
            "INSERT INTO cash_ledger(id,tenant_id,site_id,shift_id,payment_id,amount_vnd,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              randomUUID(),
              t,
              p.siteId,
              d.shift_id,
              id,
              n.amount_vnd,
              r.actor.sub,
            ],
          );
          await domainOutbox(
            c,
            "finance.payment-succeeded.v1",
            t,
            p.siteId,
            id,
            n.version,
            {
              paymentId: id,
              orderId: n.order_id,
              shiftId: n.shift_id,
              amountVnd: n.amount_vnd,
              method: "CASH",
            },
            n.order_id,
          );
          await auditEntry(c, t, r.actor.sub!, "CASH_CONFIRMED", id, old, n);
          return n;
        },
      ),
    );
  }
}
