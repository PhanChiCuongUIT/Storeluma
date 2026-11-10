import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { db, transaction } from "../../packages/platform/db.js";
import {
  authorize,
  type Grant,
} from "../../packages/platform/service-client.js";
import { auditEntry, idempotent } from "../../packages/platform/commands.js";
import {
  projectionFreshness,
  requireProjectionReady,
} from "../../packages/platform/projections.js";
import type { ActorRequest } from "../../packages/platform/http.js";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Ngày không hợp lệ.");
const filters = z
  .object({ from: day, to: day, siteId: z.uuid().optional() })
  .strict()
  .refine(
    (p) =>
      p.to >= p.from && Date.parse(p.to) - Date.parse(p.from) <= 365 * 86400000,
    "Khoảng ngày tối đa 366 ngày.",
  );
type Filters = z.infer<typeof filters>;
const siteScope = (g: Grant) => (g.role === "OWNER" ? null : g.siteIds);
const params = (t: string, p: Filters, g: Grant) => [
  t,
  p.from,
  p.to,
  p.siteId ?? null,
  siteScope(g),
];
const scope = `r.tenant_id=$1 AND ($4::uuid IS NULL OR r.site_id=$4) AND ($5::uuid[] IS NULL OR r.site_id=ANY($5))`;
const inPeriod = `(r.data->>'completedAt')::timestamptz >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND (r.data->>'completedAt')::timestamptz < (($3::date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
const saleBase = `SELECT r.* FROM read_records r WHERE ${scope} AND r.producer='sales' AND r.kind IN ('ORDER','RETURN') AND r.data->>'status'='COMPLETED' AND ${inPeriod}`;
const linesBase = `SELECT r.kind,r.site_id,(r.data->>'completedAt')::timestamptz at_time,l.value line FROM (${saleBase}) r CROSS JOIN LATERAL jsonb_array_elements(r.data->'lines') l`;
const sumText = (column: string) => `COALESCE(sum(${column}),0)::text`;
function hideCost(row: any, cost: boolean) {
  if (cost) return row;
  const { cost_vnd, profit_vnd, value_vnd, ...plain } = row;
  return plain;
}

export async function dashboard(
  c: PoolClient,
  t: string,
  p: Filters,
  g: Grant,
) {
  const values = params(t, p, g);
  const totals = (
    await c.query(
      `WITH d AS (${saleBase}) SELECT
    count(*) FILTER(WHERE kind='ORDER')::int orders,count(*) FILTER(WHERE kind='RETURN')::int returns,
    COALESCE(sum((data->>'subtotalVnd')::numeric) FILTER(WHERE kind='ORDER'),0)::text gross_vnd,
    COALESCE(sum((data->>'discountVnd')::numeric) FILTER(WHERE kind='ORDER'),0)::text discount_vnd,
    COALESCE(sum((data->>'amountVnd')::numeric) FILTER(WHERE kind='ORDER'),0)::text sales_vnd,
    COALESCE(sum((data->>'amountVnd')::numeric) FILTER(WHERE kind='RETURN'),0)::text returns_vnd,
    COALESCE(sum((CASE WHEN kind='ORDER' THEN 1 ELSE -1 END)*(data->>'amountVnd')::numeric),0)::text revenue_vnd FROM d`,
      values,
    )
  ).rows[0];
  const cost = (
    await c.query(
      `WITH l AS (${linesBase}) SELECT COALESCE(sum((CASE WHEN kind='ORDER' THEN 1 ELSE -1 END)*(line->>'costVnd')::numeric),0)::text cost_vnd FROM l`,
      values,
    )
  ).rows[0].cost_vnd;
  if (g.costRead) {
    totals.cost_vnd = cost;
    totals.profit_vnd = (BigInt(totals.revenue_vnd) - BigInt(cost)).toString();
  }
  const daily = (
    await c.query(
      `WITH d AS (${saleBase}), a AS (SELECT (data->>'completedAt')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh' local_time,kind,(data->>'amountVnd')::numeric amount FROM d)
    SELECT to_char(days.d,'YYYY-MM-DD') AS day,COALESCE(sum(amount) FILTER(WHERE kind='ORDER'),0)::text sales_vnd,
    COALESCE(sum(amount) FILTER(WHERE kind='RETURN'),0)::text returns_vnd,
    COALESCE(sum(CASE WHEN kind='ORDER' THEN amount ELSE -amount END),0)::text revenue_vnd
    FROM generate_series($2::date,$3::date,interval '1 day') days(d) LEFT JOIN a ON a.local_time::date=days.d::date GROUP BY days.d ORDER BY days.d`,
      values,
    )
  ).rows;
  const top = (
    await c.query(
      `WITH l AS (${linesBase}) SELECT line->>'skuId' sku_id,max(line->>'code') code,max(line->>'name') name,max(line->>'baseUnit') base_unit,
    COALESCE(sum((CASE WHEN kind='ORDER' THEN 1 ELSE -1 END)*(line->>'qtyBase')::numeric),0)::text qty_base,
    COALESCE(sum(CASE WHEN kind='ORDER' THEN (line->>'netVnd')::numeric ELSE -(line->>'refundVnd')::numeric END),0)::text revenue_vnd,
    COALESCE(sum((CASE WHEN kind='ORDER' THEN 1 ELSE -1 END)*(line->>'costVnd')::numeric),0)::text cost_vnd
    FROM l GROUP BY line->>'skuId' ORDER BY sum(CASE WHEN kind='ORDER' THEN (line->>'netVnd')::numeric ELSE -(line->>'refundVnd')::numeric END) DESC,line->>'skuId' LIMIT 10`,
      values,
    )
  ).rows.map((r) => hideCost(r, g.costRead));
  const bySite = (
    await c.query(
      `WITH d AS (${saleBase}) SELECT site_id,count(*) FILTER(WHERE kind='ORDER')::int orders,
    COALESCE(sum((CASE WHEN kind='ORDER' THEN 1 ELSE -1 END)*(data->>'amountVnd')::numeric),0)::text revenue_vnd FROM d GROUP BY site_id ORDER BY site_id`,
      values,
    )
  ).rows;
  return {
    filters: p,
    timezone: "Asia/Ho_Chi_Minh",
    totals,
    daily,
    top,
    bySite,
    cash: await cashReport(c, t, p, g),
    freshness: await projectionFreshness(c),
    costVisible: g.costRead,
  };
}
export async function cashReport(
  c: PoolClient,
  t: string,
  p: Filters,
  g: Grant,
) {
  const rows = (
    await c.query(
      `SELECT to_char((r.data->>'occurredAt')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS day,
    COALESCE(sum((r.data->>'amountVnd')::numeric) FILTER(WHERE r.data->>'kind'='PAYMENT'),0)::text receipts_vnd,
    COALESCE(-sum((r.data->>'amountVnd')::numeric) FILTER(WHERE r.data->>'kind'='REFUND'),0)::text refunds_vnd,
    COALESCE(sum((r.data->>'amountVnd')::numeric) FILTER(WHERE r.data->>'kind'='CASH_ENTRY' AND (r.data->>'amountVnd')::numeric>0),0)::text other_in_vnd,
    COALESCE(-sum((r.data->>'amountVnd')::numeric) FILTER(WHERE r.data->>'kind'='CASH_ENTRY' AND (r.data->>'amountVnd')::numeric<0),0)::text other_out_vnd,
    ${sumText("(r.data->>'amountVnd')::numeric")} net_vnd FROM read_records r WHERE ${scope} AND r.producer='finance' AND r.kind='MONEY'
    AND (r.data->>'occurredAt')::timestamptz >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
    AND (r.data->>'occurredAt')::timestamptz < (($3::date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') GROUP BY day ORDER BY day`,
      params(t, p, g),
    )
  ).rows;
  const totals: Record<string, string> = {};
  for (const key of [
    "receipts_vnd",
    "refunds_vnd",
    "other_in_vnd",
    "other_out_vnd",
    "net_vnd",
  ])
    totals[key] = rows.reduce((n, r) => n + BigInt(r[key]), 0n).toString();
  return { totals, daily: rows };
}
export async function stockReport(
  c: PoolClient,
  t: string,
  p: Filters,
  g: Grant,
  q = "",
  offset = 0,
  limit = 50,
) {
  const values = [...params(t, p, g), q, offset, limit];
  const base = `FROM read_records r LEFT JOIN read_records sku ON sku.producer='catalog' AND sku.kind='SKU' AND sku.tenant_id=r.tenant_id AND sku.id=(r.data->>'skuId')::uuid
    WHERE ${scope} AND r.producer='inventory' AND r.kind='STOCK' AND ($6='' OR strpos(lower(COALESCE(sku.data->>'name','')||' '||COALESCE(sku.data->>'code','')),lower($6))>0)`;
  // Reserve $2/$3 for the common filter contract; stock is a current snapshot, not a historical balance.
  const rows = (
    await c.query(
      `SELECT r.id,r.site_id,r.data->>'skuId' sku_id,COALESCE(sku.data->>'code',r.data->>'skuId') code,
    COALESCE(sku.data->>'name','Hàng đang đồng bộ tên') name,COALESCE(sku.data->>'baseUnit','') base_unit,
    r.data->>'onHand' on_hand,r.data->>'reserved' reserved,r.data->>'quarantined' quarantined,r.data->>'available' available,r.data->>'valueVnd' value_vnd,
    $2::date from_date,$3::date to_date ${base} ORDER BY sku.data->>'code',r.id OFFSET $7 LIMIT $8`,
      values,
    )
  ).rows.map(({ from_date, to_date, ...r }) => hideCost(r, g.costRead));
  const totals = (
    await c.query(
      `SELECT count(*)::int count,${sumText("(r.data->>'onHand')::numeric")} on_hand,${sumText("(r.data->>'available')::numeric")} available,
    ${sumText("(r.data->>'valueVnd')::numeric")} value_vnd,$2::date from_date,$3::date to_date ${base}`,
      values.slice(0, 6),
    )
  ).rows[0];
  delete totals.from_date;
  delete totals.to_date;
  return {
    items: rows,
    offset,
    limit,
    total: totals.count,
    totals: hideCost(totals, g.costRead),
    freshness: await projectionFreshness(c),
    pointInTime: "CURRENT",
  };
}
const scopeFingerprint = (g: Grant) => ({
  role: g.role,
  siteIds: [...g.siteIds].sort(),
  costRead: g.costRead,
  permissionVersion: g.permissionVersion,
});
function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (!/^-?\d+(\.\d+)?$/.test(s) && /^[\s]*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export const toCsv = (rows: unknown[][]) =>
  "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

@Controller("v1/tenants/:tenant")
export class Reports {
  @Get("reports/summary") async summary(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: unknown,
  ) {
    const p = filters.parse(q),
      g = await authorize(r, t, "report.read", p.siteId);
    return transaction(async (c) => {
      await c.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      );
      return dashboard(c, t, p, g);
    });
  }
  @Get("reports/stock") async stock(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: Record<string, unknown>,
  ) {
    const { q: query, offset, limit, ...rest } = q,
      p = filters.parse(rest),
      g = await authorize(r, t, "report.read", p.siteId);
    const page = z
      .object({
        q: z.string().max(120).default(""),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse({ q: query, offset, limit });
    return transaction(async (c) => {
      await c.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      );
      return stockReport(c, t, p, g, page.q, page.offset, page.limit);
    });
  }
  @Post("report-exports") async createExport(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Body() b: unknown,
  ) {
    const p = z
        .object({ kind: z.enum(["sales", "stock", "cash"]), filters })
        .strict()
        .parse(b),
      g = await authorize(r, t, "report.export", p.filters.siteId);
    await requireProjectionReady();
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:report.export`,
        r.get("idempotency-key") ?? "",
        p,
        async () => {
          await c.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`${t}:${r.actor.sub}:report.export.capacity`],
          );
          const pending = await c.query(
            "SELECT 1 FROM report_exports WHERE tenant_id=$1 AND subject_id=$2 AND status IN ('PENDING','RUNNING') AND expires_at>now() LIMIT 3",
            [t, r.actor.sub],
          );
          if (pending.rowCount === 3)
            throw new UnprocessableEntityException(
              "Đã có ba tệp đang xuất. Chờ hoàn tất trước khi tạo thêm.",
            );
          const id = randomUUID();
          await c.query(
            "INSERT INTO report_exports(id,tenant_id,subject_id,query,grant_scope) VALUES($1,$2,$3,$4,$5)",
            [id, t, r.actor.sub, p, scopeFingerprint(g)],
          );
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "REPORT_EXPORT_REQUESTED",
            id,
            null,
            p,
          );
          return { id, status: "PENDING" };
        },
      ),
    );
  }
  private async exportAccess(r: ActorRequest, t: string, id: string) {
    z.uuid().parse(t);
    z.uuid().parse(id);
    const job = (
      await db.query(
        "SELECT * FROM report_exports WHERE tenant_id=$1 AND id=$2 AND subject_id=$3",
        [t, id, r.actor.sub],
      )
    ).rows[0];
    if (!job) throw new NotFoundException("Không tìm thấy tệp xuất.");
    const g = await authorize(r, t, "report.export", job.query.filters.siteId);
    if (
      JSON.stringify(scopeFingerprint(g)) !==
      JSON.stringify(scopeFingerprint(job.grant_scope))
    )
      throw new ForbiddenException(
        "Quyền truy cập đã thay đổi. Hãy tạo tệp mới.",
      );
    if (new Date(job.expires_at).getTime() < Date.now())
      throw new GoneException("Tệp đã hết hạn. Hãy xuất lại báo cáo.");
    return job;
  }
  @Get("report-exports/:id") async exportStatus(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
  ) {
    const j = await this.exportAccess(r, t, id);
    return {
      id: j.id,
      status: j.status,
      error: j.error,
      expiresAt: j.expires_at,
      dataAsOf: j.data_as_of,
    };
  }
  @Get("report-exports/:id/download") async download(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
  ) {
    const j = await this.exportAccess(r, t, id);
    if (j.status !== "READY")
      throw new UnprocessableEntityException("Tệp chưa sẵn sàng.");
    await transaction((c) =>
      auditEntry(c, t, r.actor.sub!, "REPORT_EXPORT_DOWNLOADED", id, null, {
        kind: j.query.kind,
      }),
    );
    return { filename: j.file_name, csv: j.csv, dataAsOf: j.data_as_of };
  }
}
export async function exportTick() {
  await db.query(
    "UPDATE report_exports SET csv=NULL WHERE expires_at<now() AND csv IS NOT NULL",
  );
  const token = randomUUID(),
    j = (
      await db.query(
        `UPDATE report_exports SET status='RUNNING',lease_token=$1,lease_until=now()+interval '30 seconds'
    WHERE id=(SELECT id FROM report_exports WHERE expires_at>now() AND (status='PENDING' OR (status='RUNNING' AND lease_until<now())) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
        [token],
      )
    ).rows[0];
  if (!j) return;
  try {
    const result = await transaction(async (c) => {
      await c.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      );
      const p = j.query.filters as Filters,
        g = j.grant_scope as Grant;
      let rows: unknown[][];
      if (j.query.kind === "stock") {
        const s = await stockReport(c, j.tenant_id, p, g, "", 0, 10000);
        if (s.total > 10000) throw new Error("EXPORT_TOO_LARGE");
        rows = [
          [
            "Mã hàng",
            "Tên hàng",
            "Đơn vị",
            "Địa điểm",
            "Tồn thực tế",
            "Đang giữ",
            "Cách ly",
            "Khả dụng",
            ...(g.costRead ? ["Giá trị tồn VND"] : []),
          ],
          ...s.items.map((r) => [
            r.code,
            r.name,
            r.base_unit,
            r.site_id,
            r.on_hand,
            r.reserved,
            r.quarantined,
            r.available,
            ...(g.costRead ? [r.value_vnd] : []),
          ]),
        ];
      } else if (j.query.kind === "cash") {
        const d = await cashReport(c, j.tenant_id, p, g);
        rows = [
          [
            "Ngày",
            "Thu bán VND",
            "Hoàn khách VND",
            "Thu khác VND",
            "Chi khác VND",
            "Dòng tiền thuần VND",
          ],
          ...d.daily.map((r) => [
            r.day,
            r.receipts_vnd,
            r.refunds_vnd,
            r.other_in_vnd,
            r.other_out_vnd,
            r.net_vnd,
          ]),
        ];
      } else {
        const d = await dashboard(c, j.tenant_id, p, g);
        rows = [
          ["Ngày", "Bán hàng VND", "Trả hàng VND", "Doanh thu thuần VND"],
          ...d.daily.map((r) => [
            r.day,
            r.sales_vnd,
            r.returns_vnd,
            r.revenue_vnd,
          ]),
        ];
        rows.push([], ["Tổng doanh thu thuần VND", d.totals.revenue_vnd]);
        if (g.costRead)
          rows.push(
            ["Giá vốn thuần VND", d.totals.cost_vnd],
            ["Lãi gộp VND", d.totals.profit_vnd],
          );
      }
      const freshness = await projectionFreshness(c);
      rows.push(
        [],
        ["Múi giờ", "Asia/Ho_Chi_Minh"],
        ["Dữ liệu được đối chiếu đến", freshness.dataAsOf ?? "Đang đồng bộ"],
      );
      return { csv: toCsv(rows), asOf: freshness.dataAsOf };
    });
    await db.query(
      "UPDATE report_exports SET status='READY',csv=$3,data_as_of=$4,file_name=$5,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2",
      [
        j.id,
        token,
        result.csv,
        result.asOf,
        `Storeluma-${j.query.kind}-${j.query.filters.from}-${j.query.filters.to}.csv`,
      ],
    );
  } catch (e) {
    await db.query(
      "UPDATE report_exports SET status='FAILED',error=$3,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2",
      [
        j.id,
        token,
        (e as Error).message === "EXPORT_TOO_LARGE"
          ? "Báo cáo vượt 10.000 dòng. Chọn một địa điểm nhỏ hơn."
          : "Không thể tạo tệp. Vui lòng thử lại.",
      ],
    );
  }
}
