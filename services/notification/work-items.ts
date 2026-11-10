import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { db, transaction } from "../../packages/platform/db.js";
import {
  authorize,
  type Grant,
} from "../../packages/platform/service-client.js";
import { auditEntry, idempotent } from "../../packages/platform/commands.js";
import { projectionFreshness } from "../../packages/platform/projections.js";
import type { ActorRequest } from "../../packages/platform/http.js";

export async function evaluateWorkItems() {
  await transaction(async (c) => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    if (
      !(await c.query("SELECT pg_try_advisory_xact_lock(940901) locked"))
        .rows[0].locked
    )
      return;
    await c.query(`INSERT INTO work_items(id,tenant_id,site_id,kind,source_id,fingerprint,title,detail,actor_id)
      SELECT gen_random_uuid(),tenant_id,site_id,kind,source_id,kind||':'||source_id,title,detail,actor_id FROM work_candidates
      ON CONFLICT(tenant_id,fingerprint) WHERE status<>'RESOLVED' DO UPDATE SET detail=excluded.detail,title=excluded.title,actor_id=excluded.actor_id,
        updated_at=now(),version=work_items.version+1 WHERE work_items.detail IS DISTINCT FROM excluded.detail OR work_items.title<>excluded.title OR work_items.actor_id IS DISTINCT FROM excluded.actor_id`);
    await c.query(`UPDATE work_items w SET status='RESOLVED',resolved_at=now(),updated_at=now(),version=version+1
      WHERE status<>'RESOLVED' AND NOT EXISTS(SELECT 1 FROM work_candidates c WHERE c.tenant_id=w.tenant_id AND c.kind=w.kind AND c.source_id=w.source_id)`);
  });
}
const kinds = z.enum([
  "LOW_STOCK",
  "PAYMENT_PENDING",
  "REFUND_PENDING",
  "ORDER_REVIEW",
  "RETURN_APPROVAL",
  "SHIFT_VARIANCE",
]);
function scope(g: Grant, r: ActorRequest, t: string, site?: string) {
  return [
    t,
    site ?? null,
    g.role === "OWNER" ? null : g.siteIds,
    g.role,
    r.actor.sub,
  ];
}
const visible = `tenant_id=$1 AND ($2::uuid IS NULL OR site_id=$2) AND ($3::uuid[] IS NULL OR site_id=ANY($3))
 AND ($4 NOT IN ('CASHIER','STOCK') OR ($4='STOCK' AND kind='LOW_STOCK') OR ($4='CASHIER' AND (kind='LOW_STOCK' OR actor_id=$5)))`;
@Controller("v1/tenants/:tenant")
export class WorkItems {
  @Get("work-items") async list(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() raw: unknown,
  ) {
    const p = z
        .object({
          siteId: z.uuid().optional(),
          status: z
            .enum(["ACTIVE", "OPEN", "ACKNOWLEDGED", "RESOLVED", "ALL"])
            .default("ACTIVE"),
          kind: kinds.optional(),
          offset: z.coerce.number().int().min(0).max(1000000).default(0),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        })
        .strict()
        .parse(raw),
      g = await authorize(r, t, "notification.read", p.siteId);
    return transaction(async (c) => {
      await c.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      );
      const values = [
          ...scope(g, r, t, p.siteId),
          p.kind ?? null,
          p.status,
          p.offset,
          p.limit,
        ],
        where = `${visible} AND ($6::text IS NULL OR kind=$6) AND ($7='ALL' OR ($7='ACTIVE' AND status<>'RESOLVED') OR status=$7)`;
      const items = (
        await c.query(
          `SELECT * FROM work_items WHERE ${where} ORDER BY created_at DESC,id OFFSET $8 LIMIT $9`,
          values,
        )
      ).rows;
      const total = (
        await c.query(
          `SELECT count(*)::int total FROM work_items WHERE ${where}`,
          values.slice(0, 7),
        )
      ).rows[0].total;
      const counts = (
        await c.query(
          `SELECT count(*) FILTER(WHERE status='OPEN')::int open,count(*) FILTER(WHERE status='ACKNOWLEDGED')::int acknowledged,count(*) FILTER(WHERE status='RESOLVED')::int resolved FROM work_items WHERE ${visible} AND ($6::text IS NULL OR kind=$6)`,
          values.slice(0, 6),
        )
      ).rows[0];
      return {
        items,
        total,
        counts,
        offset: p.offset,
        limit: p.limit,
        freshness: await projectionFreshness(c),
      };
    });
  }
  @Post("work-items/:id/acknowledge") async acknowledge(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    z.uuid().parse(id);
    const p = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(raw),
      g = await authorize(r, t, "notification.ack");
    const item = (
      await db.query(`SELECT * FROM work_items WHERE ${visible} AND id=$6`, [
        ...scope(g, r, t),
        id,
      ])
    ).rows[0];
    if (!item)
      throw new NotFoundException(
        "Không tìm thấy công việc trong phạm vi được giao.",
      );
    await authorize(r, t, "notification.ack", item.site_id);
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:work.ack:${id}`,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          const current = (
            await c.query(
              "SELECT * FROM work_items WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [t, id],
            )
          ).rows[0];
          if (current.status === "RESOLVED")
            throw new ConflictException(
              "Công việc đã được giải quyết từ chứng từ nguồn.",
            );
          if (current.version !== p.version)
            throw new ConflictException(
              "Công việc đã thay đổi. Tải lại danh sách.",
            );
          if (current.status === "ACKNOWLEDGED") return current;
          const updated = (
            await c.query(
              "UPDATE work_items SET status='ACKNOWLEDGED',acknowledged_by=$3,acknowledged_at=now(),updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [t, id, r.actor.sub],
            )
          ).rows[0];
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "WORK_ACKNOWLEDGED",
            id,
            { status: current.status },
            { status: updated.status },
          );
          return updated;
        },
      ),
    );
  }
  @Get("notification-rules") async rule(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() raw: unknown,
  ) {
    const p = z.object({ siteId: z.uuid() }).strict().parse(raw);
    await authorize(r, t, "notification.manage", p.siteId);
    return (
      (
        await db.query(
          "SELECT * FROM notification_rules WHERE tenant_id=$1 AND site_id=$2",
          [t, p.siteId],
        )
      ).rows[0] ?? {
        site_id: p.siteId,
        low_stock: "5.000",
        pending_minutes: 15,
        version: 0,
      }
    );
  }
  @Patch("notification-rules/:site") async updateRule(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("site") site: string,
    @Body() raw: unknown,
  ) {
    z.uuid().parse(site);
    const p = z
      .object({
        lowStock: z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,3})?$/),
        pendingMinutes: z.number().int().min(1).max(1440),
        version: z.number().int().min(0),
      })
      .strict()
      .parse(raw);
    await authorize(r, t, "notification.manage", site);
    return transaction((c) =>
      idempotent(
        c,
        `${t}:notification.rules:${site}`,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          await c.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`notification:${t}:${site}`],
          );
          const before = (
            await c.query(
              "SELECT * FROM notification_rules WHERE tenant_id=$1 AND site_id=$2",
              [t, site],
            )
          ).rows[0];
          if ((before?.version ?? 0) !== p.version)
            throw new ConflictException(
              "Cấu hình đã thay đổi. Tải lại trước khi lưu.",
            );
          const row = (
            await c.query(
              `INSERT INTO notification_rules(tenant_id,site_id,low_stock,pending_minutes) VALUES($1,$2,$3,$4)
        ON CONFLICT(tenant_id,site_id) DO UPDATE SET low_stock=excluded.low_stock,pending_minutes=excluded.pending_minutes,version=notification_rules.version+1 RETURNING *`,
              [t, site, p.lowStock, p.pendingMinutes],
            )
          ).rows[0];
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "NOTIFICATION_RULE_UPDATED",
            site,
            before ?? null,
            row,
          );
          return row;
        },
      ),
    );
  }
}
