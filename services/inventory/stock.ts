import {
  Controller,
  Get,
  Post,
  Patch,
  Req,
  Param,
  Query,
  Body,
  Headers,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { db, transaction } from "../../packages/platform/db.js";
import {
  idempotent,
  auditEntry,
  versionInput,
  quantityInput,
  moneyInput,
  pageResult,
} from "../../packages/platform/commands.js";
import {
  authorize,
  serviceCall,
  type Grant,
} from "../../packages/platform/service-client.js";
import type { ActorRequest } from "../../packages/platform/http.js";
import { lockBalance, applyBalance } from "./stock-ledger.js";

const nonnegative = z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,3})?$/);
const adjustmentType = z.enum([
  "WRITE_OFF_GOOD",
  "WRITE_OFF_QUARANTINE",
  "QUARANTINE",
  "RELEASE_QUARANTINE",
  "CORRECTION",
]);
const lineInput = z
  .object({
    skuId: z.uuid(),
    qty: quantityInput.optional(),
    direction: z.enum(["INCREASE", "DECREASE"]).optional(),
    unitCostVnd: moneyInput.nullable().optional(),
    qualityConfirmed: z.boolean().default(false),
  })
  .strict();
const linesInput = z
  .array(lineInput)
  .min(1)
  .max(100)
  .refine(
    (ls) => new Set(ls.map((l) => l.skuId)).size === ls.length,
    "Mã hàng bị trùng.",
  );
const noteInput = z.string().trim().min(5).max(500);
const listInput = z
  .object({
    siteId: z.uuid(),
    q: z.string().trim().max(120).default(""),
    status: z
      .enum(["DRAFT", "COUNTING", "SUBMITTED", "POSTED", "CANCELLED"])
      .optional(),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
const versionBody = z.object({ version: versionInput }).strict();
const kind = (r: ActorRequest) =>
  r.path.includes("/stock-counts") ? "COUNT" : "ADJUSTMENT";
const action = (k: string, suffix: string) =>
  `stock.${k === "COUNT" ? "count" : "adjust"}.${suffix}`;
const hidden = new Set([
  "unit_cost_vnd",
  "value_delta",
  "inventory_value",
  "avg_cost",
  "value_vnd",
  "value_before",
  "value_after",
]);
function redact(value: any, grant: Grant): any {
  if (grant.costRead) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, grant));
  if (value && typeof value === "object" && !(value instanceof Date))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !hidden.has(k))
        .map(([k, v]) => [k, redact(v, grant)]),
    );
  return value;
}
async function document(
  c: Pick<PoolClient, "query">,
  t: string,
  id: string,
  k: string,
  lock = false,
) {
  const row = (
    await c.query(
      `SELECT * FROM stock_documents WHERE tenant_id=$1 AND id=$2 AND kind=$3${lock ? " FOR UPDATE" : ""}`,
      [t, id, k],
    )
  ).rows[0];
  if (!row) throw new NotFoundException("Không tìm thấy phiếu kho.");
  row.lines = (
    await c.query(
      "SELECT * FROM stock_document_lines WHERE tenant_id=$1 AND document_id=$2 ORDER BY position",
      [t, id],
    )
  ).rows;
  return row;
}
function writable(row: any, g: Grant, r: ActorRequest) {
  if (g.role === "STOCK" && row.created_by !== r.actor.sub)
    throw new ForbiddenException("Bạn chỉ thay đổi phiếu do mình lập.");
}
function currentVersion(row: any, v: number) {
  if (row.version !== v)
    throw new ConflictException(
      "Phiếu đã thay đổi. Tải lại trước khi tiếp tục.",
    );
}
async function updated(
  c: PoolClient,
  t: string,
  id: string,
  k: string,
  actor: string,
  event: string,
  before: any,
) {
  await c.query(
    "UPDATE stock_documents SET version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2",
    [t, id],
  );
  const row = await document(c, t, id, k);
  await auditEntry(c, t, actor, event, id, before, row);
  return row;
}
function validateAdjustment(type: string, lines: z.infer<typeof linesInput>) {
  for (const l of lines) {
    if (!l.qty) throw new BadRequestException("Nhập số lượng điều chỉnh.");
    if (type === "CORRECTION" && !l.direction)
      throw new BadRequestException("Chọn tăng hoặc giảm tồn.");
    if (type !== "CORRECTION" && (l.direction || l.unitCostVnd != null))
      throw new BadRequestException(
        "Loại điều chỉnh này không dùng chiều tăng/giảm hoặc giá vốn mới.",
      );
    if (type === "RELEASE_QUARANTINE" && !l.qualityConfirmed)
      throw new BadRequestException("Cần xác nhận hàng đã đạt chất lượng.");
  }
}
@Controller("v1/tenants/:tenant")
export class Stock {
  @Get("stock-balances") async balances(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: unknown,
  ) {
    const p = z
      .object({
        siteId: z.uuid(),
        skuId: z.uuid().optional(),
        q: z.string().trim().max(120).default(""),
        filter: z
          .enum(["ALL", "AVAILABLE", "EMPTY", "QUARANTINED", "FROZEN"])
          .default("ALL"),
        cursor: z.uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .strict()
      .parse(q);
    const g = await authorize(r, t, "stock.read", p.siteId);
    const rows = (
      await db.query(
        `SELECT b.*,s.code,s.name,s.base_unit,s.status sku_status,(b.on_hand-b.reserved-b.quarantined)::text available,f.document_id frozen_by
   FROM stock_balances b LEFT JOIN sku_projection s ON s.tenant_id=b.tenant_id AND s.sku_id=b.sku_id LEFT JOIN stock_freezes f ON f.tenant_id=b.tenant_id AND f.warehouse_id=b.warehouse_id AND f.sku_id=b.sku_id
   WHERE b.tenant_id=$1 AND b.warehouse_id=$2 AND ($3::uuid IS NULL OR b.sku_id=$3) AND ($4::uuid IS NULL OR b.id>$4)
   AND (coalesce(s.name,'') ILIKE $5 OR coalesce(s.code,'') ILIKE $5)
   AND ($6='ALL' OR ($6='AVAILABLE' AND b.on_hand>b.reserved+b.quarantined) OR ($6='EMPTY' AND b.on_hand=b.reserved+b.quarantined) OR ($6='QUARANTINED' AND b.quarantined>0) OR ($6='FROZEN' AND f.document_id IS NOT NULL)) ORDER BY b.id LIMIT $7`,
        [
          t,
          g.warehouseId,
          p.skuId ?? null,
          p.cursor ?? null,
          "%" + p.q + "%",
          p.filter,
          p.limit + 1,
        ],
      )
    ).rows;
    return {
      ...pageResult(redact(rows, g), p.limit),
      dataAsOf: new Date().toISOString(),
    };
  }
  @Get("stock-movements") async movements(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: unknown,
  ) {
    const p = z
      .object({
        siteId: z.uuid(),
        skuId: z.uuid().optional(),
        q: z.string().trim().max(120).default(""),
        type: z.enum(["RECEIPT", "COUNT", "ADJUSTMENT"]).optional(),
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
        cursor: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .strict()
      .parse(q);
    if (p.from && p.to && Date.parse(p.from) > Date.parse(p.to))
      throw new BadRequestException("Khoảng thời gian không hợp lệ.");
    const g = await authorize(r, t, "stock.read", p.siteId);
    let cursor: { at: string; seq: string } | undefined;
    if (p.cursor) {
      try {
        cursor = z
          .object({
            at: z.iso.datetime({ offset: true }),
            seq: z.string().regex(/^\d+$/),
          })
          .strict()
          .parse(JSON.parse(Buffer.from(p.cursor, "base64url").toString()));
      } catch {
        throw new BadRequestException("Mốc phân trang không hợp lệ.");
      }
    }
    const rows = (
      await db.query(
        `SELECT m.*,to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_time FROM stock_movements m WHERE tenant_id=$1 AND warehouse_id=$2
   AND ($3::uuid IS NULL OR sku_id=$3) AND ($4::text IS NULL OR document_type=$4) AND ($5::timestamptz IS NULL OR created_at>=$5) AND ($6::timestamptz IS NULL OR created_at<=$6)
   AND ($7::timestamptz IS NULL OR (created_at,sequence)<($7::timestamptz,$8::bigint))
   AND (sku_code ILIKE $9 OR sku_name ILIKE $9 OR document_code ILIKE $9) ORDER BY created_at DESC,sequence DESC LIMIT $10`,
        [
          t,
          g.warehouseId,
          p.skuId ?? null,
          p.type ?? null,
          p.from ?? null,
          p.to ?? null,
          cursor?.at ?? null,
          cursor?.seq ?? null,
          "%" + p.q + "%",
          p.limit + 1,
        ],
      )
    ).rows;
    const last = rows[p.limit - 1];
    return {
      items: redact(
        rows.slice(0, p.limit).map(({ cursor_time, ...row }) => ({
          ...row,
          canOpenSource: g.role !== "CASHIER",
        })),
        g,
      ),
      nextCursor:
        rows.length > p.limit
          ? Buffer.from(
              JSON.stringify({ at: last.cursor_time, seq: last.sequence }),
            ).toString("base64url")
          : null,
      dataAsOf: new Date().toISOString(),
    };
  }
  @Get(["stock-counts", "stock-adjustments"]) async list(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: unknown,
  ) {
    const p = listInput.parse(q),
      k = kind(r);
    await authorize(r, t, action(k, "read"), p.siteId);
    return {
      ...pageResult(
        (
          await db.query(
            `SELECT d.*,(SELECT count(*)::int FROM stock_document_lines l WHERE l.tenant_id=d.tenant_id AND l.document_id=d.id) line_count FROM stock_documents d WHERE tenant_id=$1 AND site_id=$2 AND kind=$3 AND ($4::text IS NULL OR status=$4) AND ($5::uuid IS NULL OR id>$5) AND (code ILIKE $6 OR note ILIKE $6) ORDER BY id LIMIT $7`,
            [
              t,
              p.siteId,
              k,
              p.status ?? null,
              p.cursor ?? null,
              "%" + p.q + "%",
              p.limit + 1,
            ],
          )
        ).rows,
        p.limit,
      ),
      dataAsOf: new Date().toISOString(),
    };
  }
  @Get(["stock-counts/:id", "stock-adjustments/:id"]) async detail(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
  ) {
    const k = kind(r);
    z.uuid().parse(id);
    await authorize(r, t, action(k, "read"));
    const d = await document(db, t, id, k),
      g = await authorize(r, t, action(k, "read"), d.site_id);
    return redact(d, g);
  }
  @Post(["stock-counts", "stock-adjustments"]) async create(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    const k = kind(r),
      p = z
        .object({
          siteId: z.uuid(),
          warehouseId: z.uuid(),
          note: noteInput,
          adjustmentType: adjustmentType.optional(),
          lines: linesInput,
        })
        .strict()
        .parse(b);
    const g = await authorize(r, t, action(k, "write"), p.siteId);
    if (g.warehouseId !== p.warehouseId)
      throw new NotFoundException("Không tìm thấy kho trong địa điểm này.");
    if (
      k === "COUNT" &&
      (p.adjustmentType ||
        p.lines.some(
          (l) =>
            l.qty || l.direction || l.unitCostVnd != null || l.qualityConfirmed,
        ))
    )
      throw new BadRequestException(
        "Phiếu kiểm nháp chỉ chọn mã hàng; số đếm được nhập sau khi bắt đầu kiểm.",
      );
    if (k === "ADJUSTMENT") {
      if (!p.adjustmentType)
        throw new BadRequestException("Chọn loại điều chỉnh.");
      validateAdjustment(p.adjustmentType, p.lines);
    }
    const row = await transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:stock.${k}.create`,
        key,
        p,
        async () => {
          const skus = await serviceCall<any[]>(
            "catalog",
            "/v1/internal/catalog/stock-skus",
            r,
            { tenantId: t, skuIds: p.lines.map((l) => l.skuId) },
          );
          const id = randomUUID(),
            code =
              (k === "COUNT" ? "KK-" : "DC-") + id.slice(0, 8).toUpperCase();
          await c.query(
            "INSERT INTO stock_documents(id,tenant_id,site_id,warehouse_id,kind,code,adjustment_type,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              id,
              t,
              p.siteId,
              p.warehouseId,
              k,
              code,
              p.adjustmentType ?? null,
              p.note,
              r.actor.sub,
            ],
          );
          for (const [i, l] of p.lines.entries()) {
            const s = skus.find((s) => s.id === l.skuId);
            if (!s) throw new NotFoundException("Không tìm thấy mã hàng.");
            await c.query(
              "INSERT INTO stock_document_lines(id,tenant_id,document_id,sku_id,sku_code,sku_name,base_unit,position,qty,direction,unit_cost_vnd,quality_confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
              [
                randomUUID(),
                t,
                id,
                l.skuId,
                s.code,
                s.name,
                s.base_unit,
                i,
                l.qty ?? null,
                l.direction ?? null,
                l.unitCostVnd ?? null,
                l.qualityConfirmed,
              ],
            );
          }
          const d = await document(c, t, id, k);
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "STOCK_" + k + "_DRAFTED",
            id,
            null,
            d,
          );
          return d;
        },
      ),
    );
    return redact(row, g);
  }
  @Post("stock-counts/:id/start") async startCount(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    const p = versionBody.parse(b),
      { g } = await this.access(r, t, id, "COUNT", "write");
    const row = await transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:count.start.${id}`,
        key,
        p,
        async () => {
          const d = await document(c, t, id, "COUNT", true);
          writable(d, g, r);
          currentVersion(d, p.version);
          if (d.status !== "DRAFT")
            throw new ConflictException("Chỉ bắt đầu từ phiếu nháp.");
          for (const l of [...d.lines].sort((a, b) =>
            a.sku_id.localeCompare(b.sku_id),
          )) {
            const balance = await lockBalance(c, t, d.warehouse_id, l.sku_id);
            if (Number(balance.reserved) !== 0)
              throw new ConflictException({
                code: "STOCK_RESERVED",
                message:
                  "Hàng đang được giữ. Hoàn tất nghiệp vụ giữ hàng trước khi kiểm.",
              });
            await c.query(
              "INSERT INTO stock_freezes(tenant_id,warehouse_id,sku_id,document_id) VALUES($1,$2,$3,$4)",
              [t, d.warehouse_id, l.sku_id, id],
            );
            await c.query(
              "UPDATE stock_document_lines SET snapshot_on_hand=$2,snapshot_quarantined=$3,snapshot_version=$4 WHERE id=$1",
              [l.id, balance.on_hand, balance.quarantined, balance.version],
            );
          }
          await c.query(
            "UPDATE stock_documents SET status='COUNTING',started_at=clock_timestamp() WHERE id=$1",
            [id],
          );
          return updated(
            c,
            t,
            id,
            "COUNT",
            r.actor.sub!,
            "STOCK_COUNT_STARTED",
            d,
          );
        },
      ),
    );
    return redact(row, g);
  }
  private async access(
    r: ActorRequest,
    t: string,
    id: string,
    k: string,
    suffix: string,
  ) {
    z.uuid().parse(id);
    await authorize(r, t, action(k, suffix));
    const d = await document(db, t, id, k),
      g = await authorize(r, t, action(k, suffix), d.site_id);
    return { d, g };
  }
  @Patch("stock-counts/:id/lines") async countLines(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    const p = z
        .object({
          version: versionInput,
          note: noteInput,
          lines: z
            .array(
              z
                .object({
                  skuId: z.uuid(),
                  good: nonnegative,
                  quarantined: nonnegative,
                  unitCostVnd: moneyInput.nullable().optional(),
                })
                .strict(),
            )
            .min(1)
            .max(100),
        })
        .strict()
        .parse(b),
      { g } = await this.access(r, t, id, "COUNT", "write");
    const row = await transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:count.lines.${id}`,
        key,
        p,
        async () => {
          const d = await document(c, t, id, "COUNT", true);
          writable(d, g, r);
          currentVersion(d, p.version);
          if (d.status !== "COUNTING")
            throw new ConflictException("Chỉ nhập số đếm khi đang kiểm.");
          if (
            new Set(p.lines.map((l) => l.skuId)).size !== d.lines.length ||
            p.lines.length !== d.lines.length ||
            p.lines.some((l) => !d.lines.some((x: any) => x.sku_id === l.skuId))
          )
            throw new BadRequestException(
              "Cần nhập đúng toàn bộ mã hàng đã khóa.",
            );
          for (const l of p.lines)
            await c.query(
              "UPDATE stock_document_lines SET counted_good=$4,counted_quarantined=$5,unit_cost_vnd=CASE WHEN $7 THEN $6::numeric ELSE unit_cost_vnd END WHERE tenant_id=$1 AND document_id=$2 AND sku_id=$3",
              [
                t,
                id,
                l.skuId,
                l.good,
                l.quarantined,
                l.unitCostVnd ?? null,
                l.unitCostVnd !== undefined,
              ],
            );
          await c.query("UPDATE stock_documents SET note=$2 WHERE id=$1", [
            id,
            p.note,
          ]);
          return updated(
            c,
            t,
            id,
            "COUNT",
            r.actor.sub!,
            "STOCK_COUNT_RECORDED",
            d,
          );
        },
      ),
    );
    return redact(row, g);
  }
  @Post("stock-counts/:id/submit") async submit(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    const p = versionBody.parse(b),
      { g } = await this.access(r, t, id, "COUNT", "write");
    const row = await transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:count.submit.${id}`,
        key,
        p,
        async () => {
          const d = await document(c, t, id, "COUNT", true);
          writable(d, g, r);
          currentVersion(d, p.version);
          if (
            d.status !== "COUNTING" ||
            d.lines.some(
              (l: any) =>
                l.counted_good === null || l.counted_quarantined === null,
            )
          )
            throw new ConflictException("Nhập đủ số đếm trước khi gửi duyệt.");
          await c.query(
            "UPDATE stock_documents SET status='SUBMITTED' WHERE id=$1",
            [id],
          );
          return updated(
            c,
            t,
            id,
            "COUNT",
            r.actor.sub!,
            "STOCK_COUNT_SUBMITTED",
            d,
          );
        },
      ),
    );
    return redact(row, g);
  }
  @Post("stock-counts/:id/reopen") async reopen(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    const p = versionBody.parse(b),
      { g } = await this.access(r, t, id, "COUNT", "approve");
    const row = await transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:count.reopen.${id}`,
        key,
        p,
        async () => {
          const d = await document(c, t, id, "COUNT", true);
          currentVersion(d, p.version);
          if (d.status !== "SUBMITTED")
            throw new ConflictException(
              "Chỉ yêu cầu đếm lại phiếu đang chờ duyệt.",
            );
          await c.query(
            "UPDATE stock_documents SET status='COUNTING' WHERE id=$1",
            [id],
          );
          return updated(
            c,
            t,
            id,
            "COUNT",
            r.actor.sub!,
            "STOCK_COUNT_REOPENED",
            d,
          );
        },
      ),
    );
    return redact(row, g);
  }
  @Patch("stock-adjustments/:id/lines") async editAdjustment(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    const p = z
        .object({ version: versionInput, note: noteInput, lines: linesInput })
        .strict()
        .parse(b),
      { g } = await this.access(r, t, id, "ADJUSTMENT", "write");
    const row = await transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:adjust.lines.${id}`,
        key,
        p,
        async () => {
          const d = await document(c, t, id, "ADJUSTMENT", true);
          writable(d, g, r);
          currentVersion(d, p.version);
          if (d.status !== "DRAFT")
            throw new ConflictException("Chỉ sửa phiếu điều chỉnh nháp.");
          validateAdjustment(d.adjustment_type, p.lines);
          if (
            p.lines.length !== d.lines.length ||
            p.lines.some((l) => !d.lines.some((x: any) => x.sku_id === l.skuId))
          )
            throw new BadRequestException(
              "Không thay đổi phạm vi mã hàng trên phiếu đã lập.",
            );
          for (const l of p.lines)
            await c.query(
              "UPDATE stock_document_lines SET qty=$4,direction=$5,unit_cost_vnd=CASE WHEN $8 THEN $6::numeric ELSE unit_cost_vnd END,quality_confirmed=$7 WHERE tenant_id=$1 AND document_id=$2 AND sku_id=$3",
              [
                t,
                id,
                l.skuId,
                l.qty,
                l.direction ?? null,
                l.unitCostVnd ?? null,
                l.qualityConfirmed,
                l.unitCostVnd !== undefined,
              ],
            );
          await c.query("UPDATE stock_documents SET note=$2 WHERE id=$1", [
            id,
            p.note,
          ]);
          return updated(
            c,
            t,
            id,
            "ADJUSTMENT",
            r.actor.sub!,
            "STOCK_ADJUSTMENT_EDITED",
            d,
          );
        },
      ),
    );
    return redact(row, g);
  }
  @Post(["stock-counts/:id/cancel", "stock-adjustments/:id/cancel"])
  async cancel(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    const k = kind(r),
      p = versionBody.parse(b),
      { g } = await this.access(r, t, id, k, "cancel");
    const row = await transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:stock.cancel.${id}`,
        key,
        p,
        async () => {
          const d = await document(c, t, id, k, true);
          writable(d, g, r);
          if (d.status === "CANCELLED") return d;
          currentVersion(d, p.version);
          if (d.status === "POSTED")
            throw new ConflictException("Phiếu đã ghi sổ không thể hủy.");
          if (k === "COUNT" && d.status !== "DRAFT")
            for (const l of [...d.lines].sort((a, b) =>
              a.sku_id.localeCompare(b.sku_id),
            ))
              await lockBalance(c, t, d.warehouse_id, l.sku_id, id);
          await c.query(
            "DELETE FROM stock_freezes WHERE tenant_id=$1 AND document_id=$2",
            [t, id],
          );
          await c.query(
            "UPDATE stock_documents SET status='CANCELLED' WHERE id=$1",
            [id],
          );
          return updated(
            c,
            t,
            id,
            k,
            r.actor.sub!,
            "STOCK_" + k + "_CANCELLED",
            d,
          );
        },
      ),
    );
    return redact(row, g);
  }
  @Post(["stock-counts/:id/approve", "stock-adjustments/:id/post"]) async post(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    const k = kind(r),
      p = versionBody.parse(b),
      { g } = await this.access(r, t, id, k, "approve");
    const row = await transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:stock.post.${id}`,
        key,
        p,
        async () => {
          const d = await document(c, t, id, k, true);
          if (d.status === "POSTED") return d;
          currentVersion(d, p.version);
          if (d.status !== (k === "COUNT" ? "SUBMITTED" : "DRAFT"))
            throw new ConflictException("Phiếu chưa ở trạng thái được duyệt.");
          await authorize(r, t, action(k, "approve"), d.site_id);
          for (const l of [...d.lines].sort((a, b) =>
            a.sku_id.localeCompare(b.sku_id),
          )) {
            const old = await lockBalance(
              c,
              t,
              d.warehouse_id,
              l.sku_id,
              k === "COUNT" ? id : undefined,
            );
            if (k === "COUNT") {
              const frozen = (
                await c.query(
                  "SELECT 1 FROM stock_freezes WHERE tenant_id=$1 AND warehouse_id=$2 AND sku_id=$3 AND document_id=$4",
                  [t, d.warehouse_id, l.sku_id, id],
                )
              ).rowCount;
              if (
                !frozen ||
                old.version !== l.snapshot_version ||
                Number(old.reserved) !== 0
              )
                throw new ConflictException(
                  "Tồn đã thay đổi so với lúc bắt đầu kiểm. Hủy và kiểm lại.",
                );
            }
            // Compute new buckets exactly; constraints below reject reserved/quarantine underflow.
            const computed = (
              await c.query(
                `SELECT
     CASE WHEN $1='COUNT' THEN $2::numeric+$3::numeric
       WHEN $4 IN ('QUARANTINE','RELEASE_QUARANTINE') THEN $5::numeric
       WHEN $4='CORRECTION' AND $6='INCREASE' THEN $5::numeric+$7::numeric ELSE $5::numeric-$7::numeric END::text on_hand,
     CASE WHEN $1='COUNT' THEN $3::numeric WHEN $4='QUARANTINE' THEN $8::numeric+$7::numeric
       WHEN $4 IN ('RELEASE_QUARANTINE','WRITE_OFF_QUARANTINE') THEN $8::numeric-$7::numeric ELSE $8::numeric END::text quarantined`,
                [
                  k,
                  l.counted_good,
                  l.counted_quarantined,
                  d.adjustment_type,
                  old.on_hand,
                  l.direction,
                  l.qty,
                  old.quarantined,
                ],
              )
            ).rows[0];
            const checks = (
              await c.query(
                "SELECT $1::numeric>=0 AND $2::numeric>=0 AND $1::numeric>=$2::numeric+$3::numeric valid,$1::numeric>$4::numeric increase",
                [
                  computed.on_hand,
                  computed.quarantined,
                  old.reserved,
                  old.on_hand,
                ],
              )
            ).rows[0];
            if (!checks.valid)
              throw new ConflictException({
                code: "INSUFFICIENT_STOCK",
                message:
                  "Số lượng vượt phần hàng được phép hoặc làm âm tồn/cách ly.",
              });
            if (
              checks.increase &&
              Number(old.on_hand) === 0 &&
              l.unit_cost_vnd === null
            )
              throw new ConflictException(
                "Cần nhập giá vốn được duyệt khi tăng từ tồn bằng 0.",
              );
            const value = (
              await c.query(
                `SELECT CASE WHEN $1::numeric=0 THEN 0 WHEN $1::numeric=$2::numeric THEN $3::numeric
      WHEN $1::numeric<$2::numeric THEN $3::numeric-round($3::numeric*($2::numeric-$1::numeric)/$2::numeric)
      ELSE $3::numeric+round(($1::numeric-$2::numeric)*coalesce($4::numeric,$3::numeric/nullif($2::numeric,0))) END::text v`,
                [
                  computed.on_hand,
                  old.on_hand,
                  old.inventory_value,
                  l.unit_cost_vnd,
                ],
              )
            ).rows[0].v;
            const next = await applyBalance(
              c,
              old,
              {
                onHand: computed.on_hand,
                quarantined: computed.quarantined,
                value,
              },
              {
                kind: k,
                id,
                code: d.code,
                line: l,
                siteId: d.site_id,
                reason: d.note,
              },
            );
            await c.query(
              "UPDATE stock_document_lines SET result_on_hand=$2,result_quarantined=$3,delta=$2::numeric-$4::numeric,value_delta=$5::numeric-$6::numeric WHERE id=$1",
              [
                l.id,
                next.on_hand,
                next.quarantined,
                old.on_hand,
                next.inventory_value,
                old.inventory_value,
              ],
            );
          }
          await c.query(
            "DELETE FROM stock_freezes WHERE tenant_id=$1 AND document_id=$2",
            [t, id],
          );
          await c.query(
            "UPDATE stock_documents SET status='POSTED',approved_by=$2,posted_at=clock_timestamp() WHERE id=$1",
            [id, r.actor.sub],
          );
          return updated(
            c,
            t,
            id,
            k,
            r.actor.sub!,
            "STOCK_" + k + "_POSTED",
            d,
          );
        },
      ),
    );
    return redact(row, g);
  }
}
