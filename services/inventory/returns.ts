import {
  Controller,
  Post,
  Req,
  Body,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { db, transaction } from "../../packages/platform/db.js";
import {
  verifyWorkflow,
  workflowCall,
} from "../../packages/platform/workflow-client.js";
import { bodyHash, auditEntry } from "../../packages/platform/commands.js";
import { lockBalance, applyBalance } from "./stock-ledger.js";
import { milli, fromMilli } from "../../packages/platform/decimal.js";
import type { ActorRequest } from "../../packages/platform/http.js";
const ref = z.object({ tenantId: z.uuid(), returnId: z.uuid() }).strict();
@Controller("v1/internal/workflows/return")
export class ReturnReceiving {
  @Post("query") async query(@Req() r: ActorRequest, @Body() b: unknown) {
    await verifyWorkflow(r, ["sales", "finance"]);
    const p = ref.parse(b),
      d = (
        await db.query(
          "SELECT * FROM return_receipts WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, p.returnId],
        )
      ).rows[0];
    if (!d) throw new NotFoundException("Chưa nhận hàng trả.");
    return d;
  }
  @Post("receive") async receive(@Req() r: ActorRequest, @Body() b: unknown) {
    await verifyWorkflow(r, ["sales"]);
    const p = ref.parse(b);
    const old = (
      await db.query(
        "SELECT * FROM return_receipts WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, p.returnId],
      )
    ).rows[0];
    if (old) return old;
    const d = await workflowCall("sales", "return/query", p);
    if (d.id !== p.returnId || d.tenant_id !== p.tenantId)
      throw new ConflictException("Tham chiếu trả hàng không khớp.");
    return transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "return:" + p.tenantId + ":" + p.returnId,
      ]);
      const prior = (
        await c.query(
          "SELECT * FROM return_receipts WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, p.returnId],
        )
      ).rows[0];
      if (prior) return prior;
      const warehouse = (
        await c.query(
          "SELECT 1 FROM warehouses WHERE tenant_id=$1 AND id=$2 AND site_id=$3",
          [p.tenantId, d.warehouse_id, d.site_id],
        )
      ).rowCount;
      if (!warehouse)
        throw new ConflictException("Kho trả hàng không thuộc địa điểm.");
      for (const l of [...d.lines].sort(
        (a, b) => a.skuId.localeCompare(b.skuId) || a.id.localeCompare(b.id),
      )) {
        const balance = await lockBalance(
          c,
          p.tenantId,
          d.warehouse_id,
          l.skuId,
        );
        await applyBalance(
          c,
          balance,
          {
            onHand: fromMilli(milli(balance.on_hand) + milli(l.qtyBase)),
            quarantined: fromMilli(
              milli(balance.quarantined) +
                (l.disposition === "QUARANTINE" ? milli(l.qtyBase) : 0n),
            ),
            value: (
              BigInt(balance.inventory_value) + BigInt(l.costVnd)
            ).toString(),
          },
          {
            kind: "RETURN",
            id: d.id,
            code: d.code,
            line: {
              id: l.id,
              sku_code: l.code,
              sku_name: l.name,
              base_unit: l.baseUnit,
            },
            siteId: d.site_id,
            reason: d.reason,
          },
        );
      }
      const n = (
        await c.query(
          "INSERT INTO return_receipts(id,tenant_id,order_id,site_id,warehouse_id,request_hash,lines) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            d.id,
            p.tenantId,
            d.order_id,
            d.site_id,
            d.warehouse_id,
            bodyHash(d.lines),
            JSON.stringify(d.lines),
          ],
        )
      ).rows[0];
      await auditEntry(
        c,
        p.tenantId,
        "service:sales",
        "RETURN_RECEIVED",
        d.id,
        null,
        n,
      );
      return n;
    });
  }
}
