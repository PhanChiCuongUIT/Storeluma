import {
  Controller,
  Get,
  Post,
  Req,
  Param,
  Body,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "../../packages/platform/db.js";
import { authorize } from "../../packages/platform/service-client.js";
import {
  auditEntry,
  idempotent,
  moneyInput,
  versionInput,
} from "../../packages/platform/commands.js";
import type { ActorRequest } from "../../packages/platform/http.js";
const reason = z.string().trim().min(3).max(500);
async function shift(c: any, t: string, id: string, lock = false) {
  z.uuid().parse(id);
  const d = (
    await c.query(
      `SELECT * FROM shifts WHERE tenant_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [t, id],
    )
  ).rows[0];
  if (!d) throw new NotFoundException("Không tìm thấy ca.");
  return d;
}
function own(d: any, r: ActorRequest, role: string) {
  if (role === "CASHIER" && d.cashier_id !== r.actor.sub)
    throw new ForbiddenException("Ca này do người khác mở.");
}
@Controller("v1/tenants/:tenant")
export class Drawer {
  @Get("shifts/:id") async detail(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
  ) {
    const d = await shift(db, t, id),
      g = await authorize(r, t, "shift.read", d.site_id);
    own(d, r, g.role);
    // A repeatable-read snapshot keeps the displayed totals and ledger consistent.
    return transaction(async (c) => {
      await c.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      );
      const current = await shift(c, t, id);
      const totals = (
        await c.query(
          `SELECT COALESCE(sum(amount_vnd) FILTER(WHERE payment_id IS NOT NULL),0)::text sales,COALESCE(-sum(amount_vnd) FILTER(WHERE refund_id IS NOT NULL),0)::text refunds,COALESCE(sum(amount_vnd) FILTER(WHERE cash_entry_id IS NOT NULL),0)::text adjustments,COALESCE(sum(amount_vnd),0)::text net FROM cash_ledger WHERE tenant_id=$1 AND shift_id=$2`,
          [t, id],
        )
      ).rows[0];
      const ledger = (
        await c.query(
          `SELECT l.*,p.order_code,f.return_id,e.kind,e.reason,e.reversal_of FROM cash_ledger l LEFT JOIN payments p ON p.tenant_id=l.tenant_id AND p.id=l.payment_id LEFT JOIN refunds f ON f.tenant_id=l.tenant_id AND f.id=l.refund_id LEFT JOIN cash_entries e ON e.tenant_id=l.tenant_id AND e.id=l.cash_entry_id WHERE l.tenant_id=$1 AND l.shift_id=$2 ORDER BY l.created_at DESC LIMIT 200`,
          [t, id],
        )
      ).rows;
      const pendingPayments = (
        await c.query(
          "SELECT id,order_id,order_code,amount_vnd FROM payments WHERE tenant_id=$1 AND shift_id=$2 AND status='PENDING'",
          [t, id],
        )
      ).rows;
      const pendingRefunds = (
        await c.query(
          "SELECT id,return_id,amount_vnd FROM refunds WHERE tenant_id=$1 AND shift_id=$2 AND status='PENDING'",
          [t, id],
        )
      ).rows;
      return {
        ...current,
        expected_now: (
          BigInt(current.opening_cash) + BigInt(totals.net)
        ).toString(),
        totals,
        ledger,
        pendingPayments,
        pendingRefunds,
      };
    });
  }
  @Post("shifts/:id/cash-entries") async entry(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    const p = z
        .object({
          kind: z.enum(["IN", "OUT"]),
          amountVnd: moneyInput.refine((s) => BigInt(s) > 0n),
          reason,
        })
        .strict()
        .parse(b),
      d = await shift(db, t, id),
      g = await authorize(r, t, "cash.write", d.site_id);
    own(d, r, g.role);
    return transaction((c) =>
      idempotent(
        c,
        t + ":drawer:" + id,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          const current = await shift(c, t, id, true);
          if (current.status !== "OPEN")
            throw new ConflictException("Ca đã đóng.");
          return this.post(
            c,
            t,
            current,
            r,
            p.kind,
            (BigInt(p.amountVnd) * (p.kind === "OUT" ? -1n : 1n)).toString(),
            p.reason,
            null,
          );
        },
      ),
    );
  }
  @Post("cash-entries/:id/reverse") async reverse(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    z.uuid().parse(id);
    const p = z.object({ shiftId: z.uuid(), reason }).strict().parse(b),
      old = (
        await db.query(
          "SELECT * FROM cash_entries WHERE tenant_id=$1 AND id=$2",
          [t, id],
        )
      ).rows[0];
    if (!old) throw new NotFoundException();
    await authorize(r, t, "cash.reverse", old.site_id);
    return transaction((c) =>
      idempotent(
        c,
        t + ":drawer-reverse:" + id,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          const current = await shift(c, t, p.shiftId, true);
          if (
            current.site_id !== old.site_id ||
            current.status !== "OPEN" ||
            old.kind === "REVERSAL"
          )
            throw new ConflictException(
              "Cần ca đang mở cùng địa điểm và phiếu thu/chi gốc.",
            );
          if (
            (
              await c.query(
                "SELECT 1 FROM cash_entries WHERE tenant_id=$1 AND reversal_of=$2",
                [t, id],
              )
            ).rowCount
          )
            throw new ConflictException("Phiếu đã được đảo.");
          return this.post(
            c,
            t,
            current,
            r,
            "REVERSAL",
            (-BigInt(old.amount_vnd)).toString(),
            p.reason,
            id,
          );
        },
      ),
    );
  }
  private async post(
    c: any,
    t: string,
    s: any,
    r: ActorRequest,
    kind: string,
    amount: string,
    note: string,
    reversal: string | null,
  ) {
    const n = (
      await c.query(
        "INSERT INTO cash_entries(id,tenant_id,site_id,shift_id,kind,amount_vnd,reason,created_by,reversal_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [
          randomUUID(),
          t,
          s.site_id,
          s.id,
          kind,
          amount,
          note,
          r.actor.sub,
          reversal,
        ],
      )
    ).rows[0];
    await c.query(
      "INSERT INTO cash_ledger(id,tenant_id,site_id,shift_id,cash_entry_id,amount_vnd,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [randomUUID(), t, s.site_id, s.id, n.id, amount, r.actor.sub],
    );
    await auditEntry(c, t, r.actor.sub!, "DRAWER_" + kind, n.id, null, n);
    return n;
  }
  @Post("shifts/:id/approve-variance") async variance(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    const p = z
        .object({ version: versionInput, note: reason })
        .strict()
        .parse(b),
      d = await shift(db, t, id),
      g = await authorize(r, t, "shift.approve", d.site_id);
    if (d.cashier_id === r.actor.sub && !g.selfApprovalAllowed)
      throw new ForbiddenException("Cần quản lý khác xác nhận chênh lệch.");
    return transaction((c) =>
      idempotent(
        c,
        t + ":variance:" + id,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          const old = await shift(c, t, id, true);
          if (
            old.status !== "CLOSED" ||
            old.version !== p.version ||
            old.variance_approved_by ||
            BigInt(old.difference_vnd) === 0n
          )
            throw new ConflictException("Ca không có chênh lệch chờ xác nhận.");
          const n = (
            await c.query(
              "UPDATE shifts SET variance_approved_by=$2,variance_approved_at=clock_timestamp(),variance_approval_note=$3,version=version+1 WHERE id=$1 RETURNING *",
              [id, r.actor.sub, p.note],
            )
          ).rows[0];
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            old.cashier_id === r.actor.sub
              ? "SHIFT_VARIANCE_SELF_APPROVED"
              : "SHIFT_VARIANCE_APPROVED",
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
