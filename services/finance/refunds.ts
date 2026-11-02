import {
  Controller,
  Post,
  Get,
  Req,
  Param,
  Body,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "../../packages/platform/db.js";
import { authorize } from "../../packages/platform/service-client.js";
import {
  workflowCall,
  verifyWorkflow,
} from "../../packages/platform/workflow-client.js";
import {
  idempotent,
  auditEntry,
  versionInput,
} from "../../packages/platform/commands.js";
import { domainOutbox } from "../../packages/platform/events.js";
import type { ActorRequest } from "../../packages/platform/http.js";
async function refund(c: any, t: string, id: string, lock = false) {
  z.uuid().parse(id);
  const d = (
    await c.query(
      `SELECT * FROM refunds WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [t, id],
    )
  ).rows[0];
  if (!d) throw new NotFoundException("Chưa có yêu cầu hoàn tiền.");
  return d;
}
@Controller("v1")
export class Refunds {
  @Post("internal/workflows/refund/create") async create(
    @Req() r: ActorRequest,
    @Body() b: unknown,
  ) {
    await verifyWorkflow(r, ["sales"]);
    const p = z
      .object({ tenantId: z.uuid(), returnId: z.uuid() })
      .strict()
      .parse(b);
    const old = (
      await db.query(
        "SELECT * FROM refunds WHERE tenant_id=$1 AND return_id=$2",
        [p.tenantId, p.returnId],
      )
    ).rows[0];
    if (old) return old;
    const d = await workflowCall("sales", "return/query", p),
      stock = await workflowCall("inventory", "return/query", p);
    if (
      stock.id !== d.id ||
      stock.order_id !== d.order_id ||
      stock.site_id !== d.site_id ||
      d.tenant_id !== p.tenantId ||
      d.id !== p.returnId
    )
      throw new ConflictException("Chưa xác minh được hàng trả.");
    return transaction(async (c) => {
      const payment = (
        await c.query(
          "SELECT * FROM payments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [p.tenantId, d.payment_id],
        )
      ).rows[0];
      if (
        !payment ||
        payment.status !== "SUCCEEDED" ||
        payment.order_id !== d.order_id ||
        payment.site_id !== d.site_id
      )
        throw new ConflictException("Thanh toán gốc không phù hợp.");
      const prior = (
        await c.query(
          "SELECT * FROM refunds WHERE tenant_id=$1 AND return_id=$2",
          [p.tenantId, p.returnId],
        )
      ).rows[0];
      if (prior) return prior;
      const held = (
        await c.query(
          "SELECT COALESCE(sum(amount_vnd),0)::text AS total FROM refunds WHERE tenant_id=$1 AND payment_id=$2",
          [p.tenantId, payment.id],
        )
      ).rows[0].total;
      if (BigInt(held) + BigInt(d.amount_vnd) > BigInt(payment.amount_vnd))
        throw new ConflictException("Tiền hoàn vượt số thực thu còn lại.");
      const n = (
        await c.query(
          "INSERT INTO refunds(id,tenant_id,site_id,return_id,order_id,payment_id,amount_vnd) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            d.refund_id,
            p.tenantId,
            d.site_id,
            d.id,
            d.order_id,
            d.payment_id,
            d.amount_vnd,
          ],
        )
      ).rows[0];
      await auditEntry(
        c,
        p.tenantId,
        "service:sales",
        "REFUND_CREATED",
        n.id,
        null,
        n,
      );
      return n;
    });
  }
  @Get("tenants/:tenant/refunds/:id") async detail(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
  ) {
    const d = await refund(db, t, id);
    await authorize(r, t, "return.read", d.site_id);
    return d;
  }
  @Post("tenants/:tenant/refunds/:id/prepare") async prepare(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.transition(r, t, id, b, false);
  }
  @Post("tenants/:tenant/refunds/:id/confirm") async confirm(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.transition(r, t, id, b, true);
  }
  private async transition(
    r: ActorRequest,
    t: string,
    id: string,
    b: unknown,
    confirm: boolean,
  ) {
    const p = (
      confirm
        ? z
            .object({
              shiftId: z.uuid(),
              version: versionInput,
              cashPaid: z.literal(true),
            })
            .strict()
        : z.object({ shiftId: z.uuid(), version: versionInput }).strict()
    ).parse(b);
    const d = await refund(db, t, id),
      g = await authorize(r, t, "refund.confirm", d.site_id);
    return transaction((c) =>
      idempotent(
        c,
        t + ":refund-" + (confirm ? "confirm:" : "prepare:") + id,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          // Lock order matches cash collection and closing: shift -> payment -> refund.
          const shift = (
            await c.query(
              "SELECT * FROM shifts WHERE tenant_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE",
              [t, d.site_id, p.shiftId],
            )
          ).rows[0];
          if (!shift)
            throw new NotFoundException("Không tìm thấy ca hoàn tiền.");
          if (g.role === "CASHIER" && shift.cashier_id !== r.actor.sub)
            throw new ForbiddenException("Ca này do người khác mở.");
          await c.query(
            "SELECT id FROM payments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [t, d.payment_id],
          );
          const old = await refund(c, t, id, true);
          if (old.status === "SUCCEEDED") return old;
          if (shift.status !== "OPEN" || old.version !== p.version)
            throw new ConflictException(
              "Ca hoặc yêu cầu hoàn tiền đã thay đổi.",
            );
          if (old.shift_id && old.shift_id !== p.shiftId)
            throw new ConflictException(
              "Yêu cầu hoàn tiền đã gắn với ca khác.",
            );
          if (confirm && old.shift_id !== p.shiftId)
            throw new ConflictException(
              "Chuẩn bị hoàn tiền trên ca trước khi xác nhận đã chi.",
            );
          const n = (
            await c.query(
              `UPDATE refunds SET shift_id=$2,version=version+1,status=$3,confirmed_by=$4,confirmed_at=CASE WHEN $3='SUCCEEDED' THEN clock_timestamp() ELSE NULL END WHERE id=$1 RETURNING *`,
              [
                id,
                p.shiftId,
                confirm ? "SUCCEEDED" : "PENDING",
                confirm ? r.actor.sub : null,
              ],
            )
          ).rows[0];
          if (confirm) {
            await c.query(
              "INSERT INTO cash_ledger(id,tenant_id,site_id,shift_id,refund_id,amount_vnd,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                randomUUID(),
                t,
                d.site_id,
                p.shiftId,
                id,
                (-BigInt(d.amount_vnd)).toString(),
                r.actor.sub,
              ],
            );
            await domainOutbox(
              c,
              "finance.refund-succeeded.v1",
              t,
              d.site_id,
              id,
              n.version,
              {
                refundId: id,
                returnId: d.return_id,
                paymentId: d.payment_id,
                shiftId: p.shiftId,
                amountVnd: d.amount_vnd,
              },
              d.return_id,
            );
          }
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            confirm ? "REFUND_CONFIRMED" : "REFUND_PREPARED",
            id,
            old,
            n,
          );
          return n;
        },
      ),
    );
  }
}
