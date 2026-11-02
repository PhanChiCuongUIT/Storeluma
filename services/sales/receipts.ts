import {
  Controller,
  Get,
  Post,
  Req,
  Param,
  Body,
  ConflictException,
} from "@nestjs/common";
import { z } from "zod";
import { db, transaction } from "../../packages/platform/db.js";
import { authorize } from "../../packages/platform/service-client.js";
import { auditEntry, idempotent } from "../../packages/platform/commands.js";
import type { ActorRequest } from "../../packages/platform/http.js";
import { order } from "./orders.js";
@Controller("v1/tenants/:tenant/orders/:id")
export class Receipts {
  @Get("receipt") async get(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
  ) {
    const { snapshot } = await this.data(r, t, id);
    const old = (
      await db.query(
        "SELECT * FROM receipts WHERE tenant_id=$1 AND order_id=$2",
        [t, id],
      )
    ).rows[0];
    return {
      snapshot: old?.snapshot ?? snapshot,
      printCount: old?.print_count ?? 0,
    };
  }
  @Post("receipt/prints") async print(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    const p = z.object({}).strict().parse(b),
      { snapshot } = await this.data(r, t, id);
    return transaction((c) =>
      idempotent(
        c,
        t + ":receipt-print:" + id,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          await c.query(
            "INSERT INTO receipts(tenant_id,order_id,snapshot) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [t, id, JSON.stringify(snapshot)],
          );
          const n = (
            await c.query(
              "UPDATE receipts SET print_count=print_count+1 WHERE tenant_id=$1 AND order_id=$2 RETURNING *",
              [t, id],
            )
          ).rows[0];
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            n.print_count > 1
              ? "RECEIPT_REPRINT_REQUESTED"
              : "RECEIPT_PRINT_REQUESTED",
            id,
            null,
            { printNumber: n.print_count },
          );
          return {
            snapshot: n.snapshot,
            printNumber: n.print_count,
            reprint: n.print_count > 1,
          };
        },
      ),
    );
  }
  private async data(r: ActorRequest, t: string, id: string) {
    const d = await order(db, t, id),
      g = await authorize(r, t, "sale.read", d.site_id);
    if (d.status !== "COMPLETED")
      throw new ConflictException(
        "Biên nhận chỉ có khi đơn đã thu tiền và xuất kho xong.",
      );
    const s = (
      await db.query(
        "SELECT payment FROM checkout_sagas WHERE tenant_id=$1 AND order_id=$2",
        [t, id],
      )
    ).rows[0];
    if (s?.payment?.status !== "SUCCEEDED")
      throw new ConflictException("Chưa xác minh được tiền đã thu.");
    return {
      snapshot: {
        orderId: d.id,
        number: d.code,
        tenantName: g.tenantName,
        siteName: g.siteName,
        siteAddress: g.siteAddress,
        completedAt: d.completed_at,
        lines: d.lines.map(({ costVnd, ...l }: any) => l),
        subtotalVnd: d.subtotal_vnd,
        discountVnd: d.discount_vnd,
        payableVnd: d.payable_vnd,
        method: "CASH",
        paidVnd: d.payable_vnd,
        tenderedVnd: s.payment.tendered_vnd,
        changeVnd: (
          BigInt(s.payment.tendered_vnd) - BigInt(d.payable_vnd)
        ).toString(),
        invoiceStatus: "NOT_ISSUED",
        taxStatus: "NOT_CONFIGURED",
      },
    };
  }
}
