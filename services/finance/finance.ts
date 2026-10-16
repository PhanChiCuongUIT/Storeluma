import { Controller, Get, Req, Param, Query } from "@nestjs/common";
import { z } from "zod";
import { db } from "../../packages/platform/db.js";
import { pageResult } from "../../packages/platform/commands.js";
import { authorize } from "../../packages/platform/service-client.js";
import type { ActorRequest } from "../../packages/platform/http.js";
@Controller("v1")
export class Finance {
  @Get("tenants/:tenant/payables") async payables(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: unknown,
  ) {
    const p = z
      .object({
        siteId: z.uuid(),
        receiptId: z.uuid().optional(),
        supplierId: z.uuid().optional(),
        cursor: z.uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .strict()
      .parse(q);
    await authorize(r, t, "payable.read", p.siteId);
    return {
      ...pageResult(
        (
          await db.query(
            "SELECT *, (total_vnd-paid_vnd)::text AS outstanding_vnd FROM payables WHERE tenant_id=$1 AND site_id=$2 AND ($3::uuid IS NULL OR receipt_id=$3) AND ($4::uuid IS NULL OR supplier_id=$4) AND ($5::uuid IS NULL OR id>$5) ORDER BY id LIMIT $6",
            [
              t,
              p.siteId,
              p.receiptId ?? null,
              p.supplierId ?? null,
              p.cursor ?? null,
              p.limit + 1,
            ],
          )
        ).rows,
        p.limit,
      ),
      dataAsOf: new Date().toISOString(),
    };
  }
}
