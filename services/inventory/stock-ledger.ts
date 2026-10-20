import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { domainOutbox } from "../../packages/platform/events.js";

/** Every stock writer must take this lock, including a SKU without a balance yet.
 * Callers acquire multiple SKU locks in sorted UUID order. Freeze and balance writes
 * share the same transaction; a preflight freeze read is never sufficient. */
export async function lockBalance(
  c: PoolClient,
  t: string,
  w: string,
  s: string,
  countId?: string,
) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `stock:${t}:${w}:${s}`,
  ]);
  const freeze = (
    await c.query(
      "SELECT document_id FROM stock_freezes WHERE tenant_id=$1 AND warehouse_id=$2 AND sku_id=$3",
      [t, w, s],
    )
  ).rows[0];
  if (freeze && freeze.document_id !== countId)
    throw new ConflictException({
      code: "STOCK_FROZEN",
      message:
        "Hàng đang kiểm kho. Hoàn tất hoặc hủy phiếu kiểm trước khi thay đổi tồn.",
    });
  await c.query(
    "INSERT INTO stock_balances(id,tenant_id,warehouse_id,sku_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,warehouse_id,sku_id) DO NOTHING",
    [randomUUID(), t, w, s],
  );
  return (
    await c.query(
      "SELECT * FROM stock_balances WHERE tenant_id=$1 AND warehouse_id=$2 AND sku_id=$3 FOR UPDATE",
      [t, w, s],
    )
  ).rows[0];
}

/** Decimal arithmetic stays in PostgreSQL numeric, never JavaScript floating point. */
export async function applyBalance(
  c: PoolClient,
  old: any,
  input: { onHand: string; quarantined: string; value: string },
  source: {
    kind: string;
    id: string;
    code: string;
    line: any;
    siteId: string;
    reason: string;
  },
) {
  const next = (
    await c.query(
      `UPDATE stock_balances SET on_hand=$2::numeric,quarantined=$3::numeric,inventory_value=$4::numeric,
 avg_cost=CASE WHEN $2::numeric=0 THEN 0 ELSE round($4::numeric/$2::numeric,6) END,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
      [old.id, input.onHand, input.quarantined, input.value],
    )
  ).rows[0];
  const l = source.line;
  await c.query(
    `INSERT INTO stock_movements(id,tenant_id,warehouse_id,sku_id,receipt_id,line_id,qty_base,value_vnd,created_at,
 document_type,document_id,document_code,document_line_id,reason,sku_code,sku_name,base_unit,on_hand_before,on_hand_after,quarantined_before,quarantined_after,value_before,value_after)
 VALUES($1,$2,$3,$4,$5,$6,$7::numeric-$8::numeric,$9::numeric-$10::numeric,clock_timestamp(),$11,$12,$13,$14,$15,$16,$17,$18,$8,$7,$19,$20,$10,$9)`,
    [
      randomUUID(),
      old.tenant_id,
      old.warehouse_id,
      old.sku_id,
      source.kind === "RECEIPT" ? source.id : null,
      source.kind === "RECEIPT" ? l.id : null,
      next.on_hand,
      old.on_hand,
      next.inventory_value,
      old.inventory_value,
      source.kind,
      source.id,
      source.code,
      l.id,
      source.reason,
      l.sku_code,
      l.sku_name,
      l.base_unit,
      old.quarantined,
      next.quarantined,
    ],
  );
  const available = (
    await c.query(
      "SELECT (on_hand-reserved-quarantined)::text available FROM stock_balances WHERE id=$1",
      [old.id],
    )
  ).rows[0].available;
  await domainOutbox(
    c,
    "inventory.stock-changed.v1",
    old.tenant_id,
    source.siteId,
    next.id,
    next.version,
    {
      warehouseId: old.warehouse_id,
      skuId: old.sku_id,
      onHand: next.on_hand,
      reserved: next.reserved,
      quarantined: next.quarantined,
      available,
      inventoryValue: next.inventory_value,
      balanceVersion: next.version,
    },
    source.id,
  );
  return next;
}
