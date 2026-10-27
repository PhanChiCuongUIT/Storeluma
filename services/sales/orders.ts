import {
  Controller,
  Get,
  Post,
  Patch,
  Req,
  Param,
  Query,
  Body,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "../../packages/platform/db.js";
import {
  authorize,
  serviceCall,
} from "../../packages/platform/service-client.js";
import {
  idempotent,
  auditEntry,
  versionInput,
  moneyInput,
  pageResult,
} from "../../packages/platform/commands.js";
import { quoteInput, price } from "./pricing.js";
import type { ActorRequest } from "../../packages/platform/http.js";

export async function order(c: any, t: string, id: string, lock = false) {
  z.uuid().parse(id);
  const d = (
    await c.query(
      `SELECT * FROM orders WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [t, id],
    )
  ).rows[0];
  if (!d) throw new NotFoundException("Không tìm thấy đơn bán.");
  return d;
}
function visible(d: any, cost: boolean) {
  return {
    ...d,
    lines: d.lines.map((l: any) => {
      const { costVnd, ...plain } = l;
      return cost ? l : plain;
    }),
  };
}
async function quote(c: any, t: string, id: string, requireFresh = true) {
  const q = (
    await c.query("SELECT * FROM quotes WHERE tenant_id=$1 AND id=$2", [t, id])
  ).rows[0];
  if (!q) throw new NotFoundException("Không tìm thấy báo giá.");
  if (requireFresh && new Date(q.expires_at).getTime() <= Date.now())
    throw new ConflictException({
      code: "QUOTE_EXPIRED",
      message: "Báo giá đã hết hạn. Cập nhật giá trước khi tiếp tục.",
    });
  return q;
}
@Controller("v1/tenants/:tenant")
export class Orders {
  @Post("sales/quotes") async quote(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Body() b: unknown,
  ) {
    const p = quoteInput.parse(b),
      g = await authorize(r, t, "sale.write", p.siteId),
      v = await price(r, t, p, g.role);
    return transaction((c) =>
      idempotent(
        c,
        t + ":quote:" + r.actor.sub,
        r.get("idempotency-key") ?? "",
        p,
        async () =>
          (
            await c.query(
              "INSERT INTO quotes(id,tenant_id,site_id,warehouse_id,created_by,request,lines,subtotal_vnd,discount_vnd,payable_vnd,pricing_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '120 seconds') RETURNING *",
              [
                randomUUID(),
                t,
                p.siteId,
                g.warehouseId,
                r.actor.sub,
                JSON.stringify(v.request),
                JSON.stringify(v.lines),
                v.subtotal,
                v.discount,
                v.payable,
                v.hash,
              ],
            )
          ).rows[0],
      ),
    );
  }
  @Post("orders") async create(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Body() b: unknown,
  ) {
    const p = z
      .object({
        quoteId: z.uuid(),
        note: z.string().trim().max(500).default(""),
      })
      .strict()
      .parse(b);
    // Replays still authorize against the quote's site, but freshness applies
    // only when the idempotent callback actually writes a new draft.
    const q = await quote(db, t, p.quoteId, false),
      g = await authorize(r, t, "sale.write", q.site_id);
    // A quote cannot be used by another role to bypass the discount cap.
    if (
      g.role === "CASHIER" &&
      BigInt(q.discount_vnd) * 100n > BigInt(q.subtotal_vnd) * 5n
    )
      throw new ConflictException("Mức giảm cần quản lý xác nhận.");
    return transaction((c) =>
      idempotent(
        c,
        t + ":order:" + r.actor.sub,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          await c.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["quote:" + p.quoteId],
          );
          const old = (
            await c.query(
              "SELECT * FROM orders WHERE tenant_id=$1 AND quote_id=$2",
              [t, p.quoteId],
            )
          ).rows[0];
          if (old) return visible(old, g.costRead);
          await quote(c, t, p.quoteId);
          const id = randomUUID(),
            code = "BH-" + id.slice(0, 8).toUpperCase();
          const d = (
            await c.query(
              "INSERT INTO orders(id,tenant_id,site_id,warehouse_id,quote_id,code,created_by,note,lines,subtotal_vnd,discount_vnd,payable_vnd) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
              [
                id,
                t,
                q.site_id,
                q.warehouse_id,
                q.id,
                code,
                r.actor.sub,
                p.note,
                JSON.stringify(q.lines),
                q.subtotal_vnd,
                q.discount_vnd,
                q.payable_vnd,
              ],
            )
          ).rows[0];
          await auditEntry(c, t, r.actor.sub!, "ORDER_DRAFTED", id, null, d);
          return d;
        },
      ),
    );
  }
  @Patch("orders/:id") async edit(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    const p = z
        .object({
          quoteId: z.uuid(),
          version: versionInput,
          note: z.string().trim().max(500).default(""),
        })
        .strict()
        .parse(b),
      d = await order(db, t, id),
      g = await authorize(r, t, "sale.write", d.site_id),
      q = await quote(db, t, p.quoteId, false);
    if (q.site_id !== d.site_id)
      throw new ConflictException("Báo giá khác địa điểm.");
    if (
      g.role === "CASHIER" &&
      BigInt(q.discount_vnd) * 100n > BigInt(q.subtotal_vnd) * 5n
    )
      throw new ConflictException("Mức giảm cần quản lý xác nhận.");
    return transaction((c) =>
      idempotent(
        c,
        t + ":order-edit:" + id,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          const old = await order(c, t, id, true);
          if (old.status !== "DRAFT" || old.version !== p.version)
            throw new ConflictException("Đơn đã thay đổi.");
          await quote(c, t, p.quoteId);
          const n = (
            await c.query(
              "UPDATE orders SET quote_id=$2,note=$3,lines=$4,subtotal_vnd=$5,discount_vnd=$6,payable_vnd=$7,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
              [
                id,
                q.id,
                p.note,
                JSON.stringify(q.lines),
                q.subtotal_vnd,
                q.discount_vnd,
                q.payable_vnd,
              ],
            )
          ).rows[0];
          await auditEntry(c, t, r.actor.sub!, "ORDER_UPDATED", id, old, n);
          return n;
        },
      ),
    );
  }
  @Get("orders") async list(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: unknown,
  ) {
    const p = z
        .object({
          siteId: z.uuid(),
          status: z
            .enum([
              "DRAFT",
              "PENDING",
              "COMMITTING",
              "REVIEW",
              "COMPLETED",
              "CANCELLED",
            ])
            .optional(),
          q: z.string().trim().max(100).default(""),
          cursor: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .strict()
        .parse(q),
      g = await authorize(r, t, "sale.read", p.siteId);
    const rows = (
      await db.query(
        "SELECT * FROM orders WHERE tenant_id=$1 AND site_id=$2 AND ($3::text IS NULL OR status=$3) AND code ILIKE $4 AND ($5::uuid IS NULL OR id>$5) ORDER BY id LIMIT $6",
        [
          t,
          p.siteId,
          p.status ?? null,
          "%" + p.q + "%",
          p.cursor ?? null,
          p.limit + 1,
        ],
      )
    ).rows;
    return pageResult(
      rows.map((d) => visible(d, g.costRead)),
      p.limit,
    );
  }
  @Get("orders/:id") async detail(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
  ) {
    const d = await order(db, t, id),
      g = await authorize(r, t, "sale.read", d.site_id),
      s = (
        await db.query(
          "SELECT stage,payment,stock_result,last_error,cancel_requested FROM checkout_sagas WHERE tenant_id=$1 AND order_id=$2",
          [t, id],
        )
      ).rows[0];
    return {
      ...visible(d, g.costRead),
      checkout: s
        ? {
            stage: s.stage,
            payment: s.payment,
            lastError: s.last_error,
            cancelRequested: s.cancel_requested,
          }
        : null,
    };
  }
  @Post("orders/:id/checkout") async checkout(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    const p = z
        .object({
          version: versionInput,
          shiftId: z.uuid(),
          tenderedVnd: moneyInput,
        })
        .strict()
        .parse(b),
      d = await order(db, t, id),
      g = await authorize(r, t, "sale.checkout", d.site_id);
    // Read cached admission before expiry/price checks; retries must not create a new saga.
    const key = r.get("idempotency-key") ?? "";
    const cached = (
      await db.query(
        "SELECT body_hash,response FROM idempotency WHERE scope=$1 AND key=$2",
        [t + ":checkout:" + id, key],
      )
    ).rows[0];
    if (cached) {
      const { bodyHash } = await import("../../packages/platform/commands.js");
      if (cached.body_hash !== bodyHash(p))
        throw new ConflictException("Mã thao tác đã dùng với nội dung khác.");
      return visible(cached.response, g.costRead);
    }
    if (d.status !== "DRAFT" || d.version !== p.version)
      throw new ConflictException(
        "Đơn đã bắt đầu thanh toán hoặc đã thay đổi.",
      );
    const q = await quote(db, t, d.quote_id),
      current = await price(r, t, q.request, g.role);
    if (current.hash !== q.pricing_hash)
      throw new ConflictException({
        code: "PRICE_CHANGED",
        message:
          "Giá bán đã thay đổi. Cập nhật báo giá và xác nhận lại tổng tiền.",
      });
    if (BigInt(p.tenderedVnd) < BigInt(d.payable_vnd))
      throw new ConflictException("Tiền khách đưa chưa đủ.");
    await serviceCall("finance", "/v1/internal/shifts/validate", r, {
      tenantId: t,
      siteId: d.site_id,
      shiftId: p.shiftId,
    });
    return transaction((c) =>
      idempotent(c, t + ":checkout:" + id, key, p, async () => {
        const old = await order(c, t, id, true);
        if (old.status !== "DRAFT" || old.version !== p.version)
          throw new ConflictException("Đơn đã thay đổi.");
        await quote(c, t, old.quote_id);
        await c.query(
          "INSERT INTO checkout_sagas(id,tenant_id,order_id,site_id,actor_id,reservation_id,payment_id,shift_id,tendered_vnd,stage) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'RESERVE')",
          [
            randomUUID(),
            t,
            id,
            d.site_id,
            r.actor.sub,
            randomUUID(),
            randomUUID(),
            p.shiftId,
            p.tenderedVnd,
          ],
        );
        const n = (
          await c.query(
            "UPDATE orders SET status='PENDING',version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
            [id],
          )
        ).rows[0];
        await auditEntry(c, t, r.actor.sub!, "CHECKOUT_STARTED", id, old, n);
        return n;
      }),
    );
  }
  @Post("orders/:id/cancel") async cancel(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    const p = z
        .object({
          version: versionInput,
          reason: z.string().trim().min(3).max(500),
        })
        .strict()
        .parse(b),
      d = await order(db, t, id);
    await authorize(r, t, "sale.cancel", d.site_id);
    return transaction((c) =>
      idempotent(
        c,
        t + ":order-cancel:" + id,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          const old = await order(c, t, id, true);
          if (
            old.version !== p.version ||
            ["COMPLETED", "CANCELLED", "COMMITTING"].includes(old.status)
          )
            throw new ConflictException(
              "Không thể hủy trạng thái đơn hiện tại.",
            );
          if (old.status === "DRAFT")
            await c.query(
              "UPDATE orders SET status='CANCELLED',cancel_reason=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
              [id, p.reason],
            );
          else
            await c.query(
              "UPDATE checkout_sagas SET cancel_requested=true,cancel_reason=$3,next_attempt_at=now() WHERE tenant_id=$1 AND order_id=$2",
              [t, id, p.reason],
            );
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "ORDER_CANCEL_REQUESTED",
            id,
            { status: old.status },
            { reason: p.reason },
          );
          return visible(await order(c, t, id), false);
        },
      ),
    );
  }
}
