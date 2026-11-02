import {
  Controller,
  Get,
  Post,
  Req,
  Param,
  Query,
  Body,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "../../packages/platform/db.js";
import { authorize } from "../../packages/platform/service-client.js";
import { verifyWorkflow } from "../../packages/platform/workflow-client.js";
import {
  idempotent,
  auditEntry,
  quantityInput,
  versionInput,
} from "../../packages/platform/commands.js";
import {
  milli,
  fromMilli,
  baseQuantity,
} from "../../packages/platform/decimal.js";
import type { ActorRequest } from "../../packages/platform/http.js";
import { order } from "./orders.js";

export const returnRef = z
  .object({ tenantId: z.uuid(), returnId: z.uuid() })
  .strict();
export async function readReturn(c: any, t: string, id: string, lock = false) {
  z.uuid().parse(id);
  const d = (
    await c.query(
      `SELECT * FROM returns WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [t, id],
    )
  ).rows[0];
  if (!d) throw new NotFoundException("Không tìm thấy phiếu trả.");
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
const reasonInput = z.string().trim().min(3).max(500);
const rounded = (amount: string, n: bigint, d: bigint) =>
  (BigInt(amount) * n * 2n + d) / (d * 2n);
@Controller("v1")
export class Returns {
  @Post("tenants/:tenant/orders/:id/returns") async request(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    const p = z
      .object({
        reason: reasonInput,
        lines: z
          .array(
            z
              .object({
                orderLineId: z.uuid(),
                quantity: quantityInput,
                disposition: z.enum(["SELLABLE", "QUARANTINE"]),
              })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .parse(b);
    const source = await order(db, t, id),
      g = await authorize(r, t, "return.request", source.site_id);
    const result = await transaction((c) =>
      idempotent(
        c,
        t + ":return-request:" + id + ":" + r.actor.sub,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          const d = await order(c, t, id, true);
          if (d.status !== "COMPLETED")
            throw new ConflictException("Chỉ trả hàng từ đơn đã hoàn tất.");
          if (
            (
              await c.query(
                "SELECT 1 FROM returns WHERE tenant_id=$1 AND order_id=$2 AND status NOT IN ('COMPLETED','CANCELLED')",
                [t, id],
              )
            ).rowCount
          )
            throw new ConflictException(
              "Đơn đang có phiếu trả chưa xong. Hoàn tất hoặc hủy phiếu đó trước.",
            );
          if (
            new Set(p.lines.map((l) => l.orderLineId)).size !== p.lines.length
          )
            throw new BadRequestException("Mỗi dòng hàng chỉ chọn một lần.");
          const previous = (
            await c.query(
              "SELECT lines FROM returns WHERE tenant_id=$1 AND order_id=$2 AND status='COMPLETED'",
              [t, id],
            )
          ).rows.flatMap((x) => x.lines);
          const lines = p.lines.map((l) => {
            const original = d.lines.find((x: any) => x.id === l.orderLineId);
            if (!original)
              throw new BadRequestException("Dòng hàng không thuộc đơn bán.");
            const sold = milli(original.quantity),
              before = previous
                .filter((x: any) => x.orderLineId === l.orderLineId)
                .reduce((n: bigint, x: any) => n + milli(x.quantity), 0n),
              after = before + milli(l.quantity);
            if (after > sold)
              throw new ConflictException(
                "Lượng trả vượt lượng còn lại của đơn.",
              );
            let qtyBase: string;
            try {
              qtyBase = baseQuantity(l.quantity, original.factor);
            } catch {
              throw new BadRequestException("Lượng quy đổi không hợp lệ.");
            }
            return {
              id: randomUUID(),
              orderLineId: l.orderLineId,
              skuId: original.skuId,
              code: original.code,
              name: original.name,
              baseUnit: original.baseUnit,
              unitName: original.unitName,
              factor: original.factor,
              quantity: fromMilli(milli(l.quantity)),
              qtyBase,
              disposition: l.disposition,
              refundVnd: (
                rounded(original.netVnd, after, sold) -
                rounded(original.netVnd, before, sold)
              ).toString(),
              costVnd: (
                rounded(original.costVnd, after, sold) -
                rounded(original.costVnd, before, sold)
              ).toString(),
            };
          });
          const checkout = (
            await c.query(
              "SELECT payment_id FROM checkout_sagas WHERE tenant_id=$1 AND order_id=$2",
              [t, id],
            )
          ).rows[0];
          const returnId = randomUUID();
          const n = (
            await c.query(
              `INSERT INTO returns(id,tenant_id,order_id,site_id,warehouse_id,payment_id,refund_id,code,lines,amount_vnd,reason,created_by,late_return) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
              [
                returnId,
                t,
                id,
                d.site_id,
                d.warehouse_id,
                checkout.payment_id,
                randomUUID(),
                "TH-" + returnId.slice(0, 8).toUpperCase(),
                JSON.stringify(lines),
                lines.reduce((n, l) => n + BigInt(l.refundVnd), 0n).toString(),
                p.reason,
                r.actor.sub,
                Date.now() - new Date(d.completed_at).getTime() > 7 * 86400000,
              ],
            )
          ).rows[0];
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "RETURN_REQUESTED",
            n.id,
            null,
            n,
          );
          return n;
        },
      ),
    );
    return visible(result, g.costRead);
  }
  @Get("tenants/:tenant/orders/:id/returns") async forOrder(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
  ) {
    const d = await order(db, t, id),
      g = await authorize(r, t, "return.read", d.site_id);
    const rows = (
      await db.query(
        "SELECT * FROM returns WHERE tenant_id=$1 AND order_id=$2 ORDER BY created_at DESC",
        [t, id],
      )
    ).rows;
    const completed = rows
      .filter((x) => x.status === "COMPLETED")
      .flatMap((x) => x.lines);
    const returned = d.lines.map((l: any) => ({
      orderLineId: l.id,
      quantity: fromMilli(
        completed
          .filter((x: any) => x.orderLineId === l.id)
          .reduce((n: bigint, x: any) => n + milli(x.quantity), 0n),
      ),
    }));
    return {
      items: rows.map((x) => visible(x, g.costRead)),
      returned,
      returnStatus: completed.length
        ? returned.every(
            (x: any) =>
              milli(x.quantity) ===
              milli(d.lines.find((l: any) => l.id === x.orderLineId).quantity),
          )
          ? "FULL"
          : "PARTIAL"
        : "NONE",
    };
  }
  @Get("tenants/:tenant/returns") async list(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: unknown,
  ) {
    const p = z
        .object({
          siteId: z.uuid(),
          status: z
            .enum([
              "REQUESTED",
              "APPROVED",
              "REFUND_PENDING",
              "COMPLETED",
              "CANCELLED",
            ])
            .optional(),
        })
        .strict()
        .parse(q),
      g = await authorize(r, t, "return.read", p.siteId);
    return {
      items: (
        await db.query(
          "SELECT * FROM returns WHERE tenant_id=$1 AND site_id=$2 AND ($3::text IS NULL OR status=$3) ORDER BY created_at DESC LIMIT 100",
          [t, p.siteId, p.status ?? null],
        )
      ).rows.map((d) => visible(d, g.costRead)),
    };
  }
  @Get("tenants/:tenant/returns/:id") async detail(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
  ) {
    const d = await readReturn(db, t, id),
      g = await authorize(r, t, "return.read", d.site_id),
      s = (
        await db.query(
          "SELECT stage,last_error,refund FROM return_sagas WHERE tenant_id=$1 AND return_id=$2",
          [t, id],
        )
      ).rows[0];
    return { ...visible(d, g.costRead), progress: s ?? null };
  }
  @Post("tenants/:tenant/returns/:id/approve") async approve(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    const p = z
        .object({
          version: versionInput,
          note: z.string().trim().max(500).default(""),
        })
        .strict()
        .parse(b),
      d = await readReturn(db, t, id),
      g = await authorize(r, t, "return.approve", d.site_id);
    if (d.created_by === r.actor.sub && !g.selfApprovalAllowed)
      throw new ForbiddenException("Cần người quản lý khác duyệt phiếu này.");
    const n = await transaction((c) =>
      idempotent(
        c,
        t + ":return-approve:" + id,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          const old = await readReturn(c, t, id, true);
          if (old.status !== "REQUESTED" || old.version !== p.version)
            throw new ConflictException("Phiếu trả đã thay đổi.");
          if (old.late_return && !p.note)
            throw new ConflictException(
              "Phiếu quá hạn 7 ngày cần ghi lý do duyệt ngoại lệ.",
            );
          const next = (
            await c.query(
              "UPDATE returns SET status='APPROVED',version=version+1,approved_by=$2,approval_note=$3,approved_at=clock_timestamp() WHERE id=$1 RETURNING *",
              [id, r.actor.sub, p.note],
            )
          ).rows[0];
          await c.query(
            "INSERT INTO return_sagas(id,tenant_id,return_id,stage) VALUES($1,$2,$3,'RECEIVE')",
            [randomUUID(), t, id],
          );
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            old.created_by === r.actor.sub
              ? "RETURN_SELF_APPROVED"
              : "RETURN_APPROVED",
            id,
            old,
            next,
          );
          return next;
        },
      ),
    );
    return visible(n, g.costRead);
  }
  @Post("tenants/:tenant/returns/:id/cancel") async cancel(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    const p = z
        .object({ version: versionInput, reason: reasonInput })
        .strict()
        .parse(b),
      d = await readReturn(db, t, id),
      g = await authorize(r, t, "return.request", d.site_id);
    if (g.role === "CASHIER" && d.created_by !== r.actor.sub)
      throw new ForbiddenException("Chỉ được hủy phiếu do mình lập.");
    const n = await transaction((c) =>
      idempotent(
        c,
        t + ":return-cancel:" + id,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          const old = await readReturn(c, t, id, true);
          if (old.status !== "REQUESTED" || old.version !== p.version)
            throw new ConflictException("Chỉ hủy phiếu chưa được duyệt.");
          const next = (
            await c.query(
              "UPDATE returns SET status='CANCELLED',version=version+1 WHERE id=$1 RETURNING *",
              [id],
            )
          ).rows[0];
          await auditEntry(c, t, r.actor.sub!, "RETURN_CANCELLED", id, old, {
            ...next,
            cancelReason: p.reason,
          });
          return next;
        },
      ),
    );
    return visible(n, g.costRead);
  }
  @Post("internal/workflows/return/query") async workflow(
    @Req() r: ActorRequest,
    @Body() b: unknown,
  ) {
    await verifyWorkflow(r, ["inventory", "finance"]);
    const p = returnRef.parse(b),
      d = await readReturn(db, p.tenantId, p.returnId);
    if (!["APPROVED", "REFUND_PENDING", "COMPLETED"].includes(d.status))
      throw new ConflictException("Phiếu trả chưa được duyệt.");
    return d;
  }
}
