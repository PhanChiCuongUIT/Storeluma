import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Req,
  Headers,
  Query,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { db, transaction } from "../../packages/platform/db.js";
import {
  nameInput,
  codeInput,
  moneyInput,
  quantityInput,
  versionInput,
  statusInput,
  idempotent,
  auditEntry,
  pageInput,
  pageResult,
} from "../../packages/platform/commands.js";
import { baseQuantity, lineCost } from "../../packages/platform/decimal.js";
import { domainOutbox } from "../../packages/platform/events.js";
import {
  authorize,
  serviceCall,
} from "../../packages/platform/service-client.js";
import type { ActorRequest } from "../../packages/platform/http.js";
const supplierInput = z
  .object({
    name: nameInput,
    phone: z.string().trim().max(30).nullable().default(null),
    address: z.string().trim().max(300).nullable().default(null),
  })
  .strict();
const draftInput = z
  .object({
    siteId: z.uuid(),
    warehouseId: z.uuid(),
    sourceType: z.enum(["PURCHASE", "OPENING_STOCK"]),
    supplierId: z.uuid().nullable(),
    note: z.string().trim().max(500).default(""),
    lines: z
      .array(
        z
          .object({
            skuId: z.uuid(),
            unitId: z.uuid(),
            qty: quantityInput,
            unitCostVnd: moneyInput,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) =>
      v.sourceType === "PURCHASE" ? !!v.supplierId : v.supplierId === null,
    "Chọn nhà cung cấp cho phiếu mua hàng.",
  )
  .refine(
    (v) => new Set(v.lines.map((l) => l.skuId)).size === v.lines.length,
    "Mỗi mã hàng chỉ xuất hiện một lần trong phiếu.",
  );
async function details(c: Pick<PoolClient, "query">, t: string, id: string) {
  const row = (
    await c.query("SELECT * FROM receipts WHERE tenant_id=$1 AND id=$2", [
      t,
      id,
    ])
  ).rows[0];
  if (!row) throw new NotFoundException("Không tìm thấy phiếu nhập.");
  return {
    ...row,
    lines: (
      await c.query(
        "SELECT * FROM receipt_lines WHERE tenant_id=$1 AND receipt_id=$2 ORDER BY position",
        [t, id],
      )
    ).rows,
  };
}
async function supplier(c: PoolClient, t: string, id: string | null) {
  if (!id) return null;
  const row = (
    await c.query(
      "SELECT * FROM suppliers WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' FOR SHARE",
      [t, id],
    )
  ).rows[0];
  if (!row) throw new ConflictException("Nhà cung cấp không hoạt động.");
  return row;
}
async function snapshots(
  r: ActorRequest,
  t: string,
  lines: { skuId: string; unitId: string; qty: string; unitCostVnd: string }[],
) {
  const catalog = await serviceCall<any[]>(
    "catalog",
    "/v1/internal/catalog/snapshots",
    r,
    {
      tenantId: t,
      lines: lines.map(({ skuId, unitId }) => ({ skuId, unitId })),
    },
  );
  try {
    return lines.map((l, i) => ({
      ...l,
      snapshot: catalog[i],
      qtyBase: baseQuantity(l.qty, catalog[i].factor),
      totalVnd: lineCost(l.qty, l.unitCostVnd),
    }));
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
}
function total(lines: { totalVnd: string }[]) {
  const v = lines.reduce((s, l) => s + BigInt(l.totalVnd), 0n);
  if (v > 99999999999999999999n)
    throw new BadRequestException("Tổng tiền vượt giới hạn.");
  return v.toString();
}
async function saveLines(
  c: PoolClient,
  t: string,
  id: string,
  lines: Awaited<ReturnType<typeof snapshots>>,
) {
  await c.query(
    "DELETE FROM receipt_lines WHERE tenant_id=$1 AND receipt_id=$2",
    [t, id],
  );
  for (const [i, l] of lines.entries()) {
    const s = l.snapshot;
    await c.query(
      "INSERT INTO receipt_lines(id,tenant_id,receipt_id,position,sku_id,unit_id,sku_code,sku_name,unit_name,base_unit,factor,qty,qty_base,unit_cost_vnd,total_vnd) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
      [
        randomUUID(),
        t,
        id,
        i,
        l.skuId,
        l.unitId,
        s.code,
        s.name,
        s.unit_name,
        s.base_unit,
        s.factor,
        l.qty,
        l.qtyBase,
        l.unitCostVnd,
        l.totalVnd,
      ],
    );
  }
}
@Controller("v1")
export class Inventory {
  @Get("tenants/:tenant/suppliers") async suppliers(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: Record<string, unknown>,
  ) {
    await authorize(r, t, "supplier.read");
    const p = pageInput(q);
    return pageResult(
      (
        await db.query(
          "SELECT * FROM suppliers WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::uuid IS NULL OR id>$3) AND (name ILIKE $4 OR code ILIKE $4 OR phone ILIKE $4) ORDER BY id LIMIT $5",
          [t, p.status ?? null, p.cursor ?? null, "%" + p.q + "%", p.limit + 1],
        )
      ).rows,
      p.limit,
    );
  }
  @Post("tenants/:tenant/suppliers") async createSupplier(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    await authorize(r, t, "supplier.write");
    const input = supplierInput.extend({ code: codeInput }).parse(b);
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:supplier.create`,
        key,
        input,
        async () => {
          const row = (
            await c.query(
              "INSERT INTO suppliers(id,tenant_id,code,name,phone,address) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
              [
                randomUUID(),
                t,
                input.code,
                input.name,
                input.phone,
                input.address,
              ],
            )
          ).rows[0];
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "SUPPLIER_CREATED",
            row.id,
            null,
            row,
          );
          return row;
        },
      ),
    );
  }
  @Patch("tenants/:tenant/suppliers/:id") async updateSupplier(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    await authorize(r, t, "supplier.write");
    z.uuid().parse(id);
    const input = supplierInput
      .extend({ version: versionInput, status: statusInput })
      .parse(b);
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:supplier.${id}`,
        key,
        input,
        async () => {
          const old = (
            await c.query(
              "SELECT * FROM suppliers WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [t, id],
            )
          ).rows[0];
          if (!old) throw new NotFoundException();
          if (old.version !== input.version)
            throw new ConflictException(
              "Nhà cung cấp đã thay đổi. Vui lòng tải lại.",
            );
          const row = (
            await c.query(
              "UPDATE suppliers SET name=$3,phone=$4,address=$5,status=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [t, id, input.name, input.phone, input.address, input.status],
            )
          ).rows[0];
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "SUPPLIER_UPDATED",
            id,
            old,
            row,
          );
          return row;
        },
      ),
    );
  }
  @Get("tenants/:tenant/receipts") async receipts(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: Record<string, unknown>,
  ) {
    const p = z
      .object({
        siteId: z.uuid(),
        q: z.string().trim().max(120).default(""),
        status: z.enum(["DRAFT", "POSTED", "CANCELLED"]).optional(),
        supplierId: z.uuid().optional(),
        cursor: z.uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .strict()
      .parse(q);
    await authorize(r, t, "receipt.read", p.siteId);
    return pageResult(
      (
        await db.query(
          "SELECT * FROM receipts WHERE tenant_id=$1 AND site_id=$2 AND ($3::text IS NULL OR status=$3) AND ($4::uuid IS NULL OR id>$4) AND (code ILIKE $5 OR supplier_name ILIKE $5) AND ($7::uuid IS NULL OR supplier_id=$7) ORDER BY id LIMIT $6",
          [
            t,
            p.siteId,
            p.status ?? null,
            p.cursor ?? null,
            "%" + p.q + "%",
            p.limit + 1,
            p.supplierId ?? null,
          ],
        )
      ).rows,
      p.limit,
    );
  }
  @Get("tenants/:tenant/receipts/:id") async receipt(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
  ) {
    await authorize(r, t, "receipt.read");
    z.uuid().parse(id);
    const row = await details(db, t, id);
    await authorize(r, t, "receipt.read", row.site_id);
    return row;
  }
  @Post("tenants/:tenant/receipts") async createReceipt(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    const input = draftInput.parse(b),
      grant = await authorize(
        r,
        t,
        input.sourceType === "OPENING_STOCK"
          ? "receipt.opening"
          : "receipt.write",
        input.siteId,
      );
    if (grant.warehouseId !== input.warehouseId)
      throw new ForbiddenException("Kho không thuộc địa điểm đã chọn.");
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:receipt.create`,
        key,
        input,
        async () => {
          const lines = await snapshots(r, t, input.lines),
            s = await supplier(c, t, input.supplierId),
            id = randomUUID();
          await c.query(
            "INSERT INTO receipts(id,tenant_id,site_id,warehouse_id,code,source_type,supplier_id,supplier_name,note,total_vnd,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            [
              id,
              t,
              input.siteId,
              input.warehouseId,
              "PN-" + id.slice(0, 8).toUpperCase(),
              input.sourceType,
              input.supplierId,
              s?.name ?? null,
              input.note,
              total(lines),
              r.actor.sub,
            ],
          );
          await saveLines(c, t, id, lines);
          const row = await details(c, t, id);
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "RECEIPT_DRAFTED",
            id,
            null,
            row,
          );
          return row;
        },
      ),
    );
  }
  @Patch("tenants/:tenant/receipts/:id") async editReceipt(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    z.uuid().parse(id);
    const input = z
        .object({ version: versionInput, draft: draftInput })
        .strict()
        .parse(b),
      d = input.draft,
      grant = await authorize(
        r,
        t,
        d.sourceType === "OPENING_STOCK" ? "receipt.opening" : "receipt.write",
        d.siteId,
      );
    if (grant.warehouseId !== d.warehouseId) throw new ForbiddenException();
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:receipt.edit.${id}`,
        key,
        input,
        async () => {
          const old = (
            await c.query(
              "SELECT * FROM receipts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [t, id],
            )
          ).rows[0];
          if (
            !old ||
            old.site_id !== d.siteId ||
            old.warehouse_id !== d.warehouseId
          )
            throw new NotFoundException("Không tìm thấy phiếu ở địa điểm này.");
          if (old.status !== "DRAFT" || old.version !== input.version)
            throw new ConflictException("Phiếu đã thay đổi hoặc đã ghi sổ.");
          if (grant.role === "STOCK" && old.created_by !== r.actor.sub)
            throw new ForbiddenException(
              "Bạn chỉ sửa được phiếu nháp do mình lập.",
            );
          if (old.source_type === "OPENING_STOCK" && grant.role !== "OWNER")
            throw new ForbiddenException();
          const lines = await snapshots(r, t, d.lines),
            s = await supplier(c, t, d.supplierId);
          await c.query(
            "UPDATE receipts SET source_type=$3,supplier_id=$4,supplier_name=$5,note=$6,total_vnd=$7,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [
              t,
              id,
              d.sourceType,
              d.supplierId,
              s?.name ?? null,
              d.note,
              total(lines),
            ],
          );
          await saveLines(c, t, id, lines);
          const row = await details(c, t, id);
          await auditEntry(c, t, r.actor.sub!, "RECEIPT_EDITED", id, old, row);
          return row;
        },
      ),
    );
  }
  @Post("tenants/:tenant/receipts/:id/post") async postReceipt(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    z.uuid().parse(id);
    const input = z.object({ version: versionInput }).strict().parse(b);
    await authorize(r, t, "receipt.post");
    const current = await details(db, t, id);
    await authorize(
      r,
      t,
      current.source_type === "OPENING_STOCK"
        ? "receipt.opening"
        : "receipt.post",
      current.site_id,
    );
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:receipt.post.${id}`,
        key,
        input,
        async () => {
          const old = (
            await c.query(
              "SELECT * FROM receipts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [t, id],
            )
          ).rows[0];
          if (old.status === "POSTED") return details(c, t, id);
          if (old.status !== "DRAFT" || old.version !== input.version)
            throw new ConflictException("Phiếu đã thay đổi. Vui lòng tải lại.");
          // A draft can change its source while we await authorization: check the locked value again.
          await authorize(
            r,
            t,
            old.source_type === "OPENING_STOCK"
              ? "receipt.opening"
              : "receipt.post",
            old.site_id,
          );
          const draft = await details(c, t, id),
            checked = await snapshots(
              r,
              t,
              draft.lines.map((l: any) => ({
                skuId: l.sku_id,
                unitId: l.unit_id,
                qty: l.qty,
                unitCostVnd: l.unit_cost_vnd,
              })),
            );
          await supplier(c, t, old.supplier_id);
          if (
            checked.some((l, i) => l.qtyBase !== draft.lines[i].qty_base) ||
            total(checked) !== old.total_vnd
          )
            throw new ConflictException("Quy đổi trên phiếu không còn hợp lệ.");
          for (const l of [...draft.lines].sort((a, b) =>
            a.sku_id.localeCompare(b.sku_id),
          )) {
            await c.query(
              "INSERT INTO stock_balances(id,tenant_id,warehouse_id,sku_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,warehouse_id,sku_id) DO NOTHING",
              [randomUUID(), t, old.warehouse_id, l.sku_id],
            );
            const balance = (
              await c.query(
                "UPDATE stock_balances SET avg_cost=round((inventory_value+$5::numeric)/(on_hand+$4::numeric),6),on_hand=on_hand+$4::numeric,inventory_value=inventory_value+$5::numeric,version=version+1,updated_at=now() WHERE tenant_id=$1 AND warehouse_id=$2 AND sku_id=$3 RETURNING *",
                [t, old.warehouse_id, l.sku_id, l.qty_base, l.total_vnd],
              )
            ).rows[0];
            await c.query(
              "INSERT INTO stock_movements(id,tenant_id,warehouse_id,sku_id,receipt_id,line_id,qty_base,value_vnd) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
              [
                randomUUID(),
                t,
                old.warehouse_id,
                l.sku_id,
                id,
                l.id,
                l.qty_base,
                l.total_vnd,
              ],
            );
            const available = (
              await c.query(
                "SELECT (on_hand-reserved-quarantined)::text AS available FROM stock_balances WHERE id=$1",
                [balance.id],
              )
            ).rows[0].available;
            await domainOutbox(
              c,
              "inventory.stock-changed.v1",
              t,
              old.site_id,
              balance.id,
              balance.version,
              {
                warehouseId: old.warehouse_id,
                skuId: l.sku_id,
                onHand: balance.on_hand,
                reserved: balance.reserved,
                quarantined: balance.quarantined,
                available,
                inventoryValue: balance.inventory_value,
                balanceVersion: balance.version,
              },
              id,
            );
          }
          await c.query(
            "UPDATE receipts SET status='POSTED',posted_at=now(),posted_by=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [t, id, r.actor.sub],
          );
          const row = await details(c, t, id);
          await domainOutbox(
            c,
            "inventory.receipt-posted.v1",
            t,
            old.site_id,
            id,
            row.version,
            {
              receiptId: id,
              sourceType: row.source_type,
              supplierId: row.supplier_id,
              supplierName: row.supplier_name,
              warehouseId: row.warehouse_id,
              totalVnd: row.total_vnd,
              postedAt: row.posted_at.toISOString(),
              lines: row.lines.map((l: any) => ({
                lineId: l.id,
                skuId: l.sku_id,
                qtyBase: l.qty_base,
                totalVnd: l.total_vnd,
              })),
            },
          );
          await auditEntry(c, t, r.actor.sub!, "RECEIPT_POSTED", id, old, row);
          return row;
        },
      ),
    );
  }
  @Post("tenants/:tenant/receipts/:id/cancel") async cancelReceipt(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    z.uuid().parse(id);
    const input = z.object({ version: versionInput }).strict().parse(b);
    await authorize(r, t, "receipt.write");
    const current = await details(db, t, id),
      grant = await authorize(
        r,
        t,
        current.source_type === "OPENING_STOCK"
          ? "receipt.opening"
          : "receipt.write",
        current.site_id,
      );
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:receipt.cancel.${id}`,
        key,
        input,
        async () => {
          const old = (
            await c.query(
              "SELECT * FROM receipts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [t, id],
            )
          ).rows[0];
          if (old.status !== "DRAFT" || old.version !== input.version)
            throw new ConflictException(
              "Chỉ hủy được phiếu nháp chưa thay đổi.",
            );
          if (
            (old.source_type === "OPENING_STOCK" && grant.role !== "OWNER") ||
            (grant.role === "STOCK" && old.created_by !== r.actor.sub)
          )
            throw new ForbiddenException();
          const row = (
            await c.query(
              "UPDATE receipts SET status='CANCELLED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [t, id],
            )
          ).rows[0];
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "RECEIPT_CANCELLED",
            id,
            old,
            row,
          );
          return row;
        },
      ),
    );
  }
  @Get("tenants/:tenant/stock-balances") async balances(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: unknown,
  ) {
    const p = z
        .object({
          siteId: z.uuid(),
          skuId: z.uuid().optional(),
          cursor: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        })
        .strict()
        .parse(q),
      grant = await authorize(r, t, "stock.read", p.siteId);
    const rows = (
      await db.query(
        "SELECT b.*,s.code,s.name,s.base_unit,(b.on_hand-b.reserved-b.quarantined)::text AS available FROM stock_balances b LEFT JOIN sku_projection s ON s.tenant_id=b.tenant_id AND s.sku_id=b.sku_id WHERE b.tenant_id=$1 AND b.warehouse_id=$2 AND ($3::uuid IS NULL OR b.sku_id=$3) AND ($4::uuid IS NULL OR b.id>$4) ORDER BY b.id LIMIT $5",
        [t, grant.warehouseId, p.skuId ?? null, p.cursor ?? null, p.limit + 1],
      )
    ).rows;
    return pageResult(
      rows.map((row) => {
        if (!grant.costRead) {
          delete row.inventory_value;
          delete row.avg_cost;
        }
        return row;
      }),
      p.limit,
    );
  }
}
