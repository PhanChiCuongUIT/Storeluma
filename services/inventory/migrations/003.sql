-- Preserve receipt history while adding independent count and adjustment documents.
CREATE TABLE stock_documents (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, site_id uuid NOT NULL, warehouse_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('COUNT','ADJUSTMENT')), code text NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','COUNTING','SUBMITTED','POSTED','CANCELLED')),
 adjustment_type text CHECK(adjustment_type IN ('WRITE_OFF_GOOD','WRITE_OFF_QUARANTINE','QUARANTINE','RELEASE_QUARANTINE','CORRECTION')),
 note varchar(500) NOT NULL, created_by text NOT NULL, approved_by text, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, posted_at timestamptz,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,code), FOREIGN KEY(tenant_id,warehouse_id) REFERENCES warehouses(tenant_id,id),
 CHECK((kind='COUNT' AND adjustment_type IS NULL) OR (kind='ADJUSTMENT' AND adjustment_type IS NOT NULL)),
 CHECK(kind='COUNT' OR status IN ('DRAFT','POSTED','CANCELLED'))
);
CREATE TABLE stock_document_lines (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, document_id uuid NOT NULL, sku_id uuid NOT NULL,
 sku_code text NOT NULL, sku_name text NOT NULL, base_unit text NOT NULL, position integer NOT NULL,
 snapshot_on_hand numeric(18,3), snapshot_quarantined numeric(18,3), snapshot_version integer,
 counted_good numeric(18,3) CHECK(counted_good>=0), counted_quarantined numeric(18,3) CHECK(counted_quarantined>=0),
 qty numeric(18,3) CHECK(qty>0), direction text CHECK(direction IN ('INCREASE','DECREASE')),
 unit_cost_vnd numeric(20,0) CHECK(unit_cost_vnd>=0), quality_confirmed boolean NOT NULL DEFAULT false,
 result_on_hand numeric(18,3), result_quarantined numeric(18,3), delta numeric(18,3), value_delta numeric(20,0),
 UNIQUE(tenant_id,document_id,sku_id), FOREIGN KEY(tenant_id,document_id) REFERENCES stock_documents(tenant_id,id)
);
CREATE TABLE stock_freezes (
 tenant_id uuid NOT NULL, warehouse_id uuid NOT NULL, sku_id uuid NOT NULL, document_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,warehouse_id,sku_id), FOREIGN KEY(tenant_id,document_id) REFERENCES stock_documents(tenant_id,id)
);
ALTER TABLE stock_movements ALTER COLUMN receipt_id DROP NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN line_id DROP NOT NULL;
ALTER TABLE stock_movements ADD COLUMN sequence bigserial UNIQUE;
ALTER TABLE stock_movements ADD COLUMN document_type text NOT NULL DEFAULT 'RECEIPT' CHECK(document_type IN ('RECEIPT','COUNT','ADJUSTMENT'));
ALTER TABLE stock_movements ADD COLUMN document_id uuid;
ALTER TABLE stock_movements ADD COLUMN document_code text;
ALTER TABLE stock_movements ADD COLUMN document_line_id uuid;
ALTER TABLE stock_movements ADD COLUMN reason text NOT NULL DEFAULT '';
ALTER TABLE stock_movements ADD COLUMN sku_code text;
ALTER TABLE stock_movements ADD COLUMN sku_name text;
ALTER TABLE stock_movements ADD COLUMN base_unit text;
ALTER TABLE stock_movements ADD COLUMN on_hand_before numeric(18,3);
ALTER TABLE stock_movements ADD COLUMN on_hand_after numeric(18,3);
ALTER TABLE stock_movements ADD COLUMN quarantined_before numeric(18,3) NOT NULL DEFAULT 0;
ALTER TABLE stock_movements ADD COLUMN quarantined_after numeric(18,3) NOT NULL DEFAULT 0;
ALTER TABLE stock_movements ADD COLUMN value_before numeric(20,0);
ALTER TABLE stock_movements ADD COLUMN value_after numeric(20,0);
ALTER TABLE stock_movements ADD COLUMN reconstructed boolean NOT NULL DEFAULT false;
UPDATE stock_movements m SET document_id=m.receipt_id,document_code=r.code,document_line_id=m.line_id,
 sku_code=l.sku_code,sku_name=l.sku_name,base_unit=l.base_unit,reason=r.note,reconstructed=true
 FROM receipts r,receipt_lines l WHERE r.id=m.receipt_id AND r.tenant_id=m.tenant_id AND l.id=m.line_id AND l.tenant_id=m.tenant_id;
WITH history AS (
 SELECT id,sum(qty_base) OVER w q,sum(value_vnd) OVER w v FROM stock_movements
 WINDOW w AS (PARTITION BY tenant_id,warehouse_id,sku_id ORDER BY created_at,id ROWS UNBOUNDED PRECEDING)
) UPDATE stock_movements m SET on_hand_before=h.q-m.qty_base,on_hand_after=h.q,value_before=h.v-m.value_vnd,value_after=h.v FROM history h WHERE h.id=m.id;
ALTER TABLE stock_movements ALTER COLUMN document_id SET NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN document_code SET NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN document_line_id SET NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN on_hand_before SET NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN on_hand_after SET NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN value_before SET NOT NULL;
ALTER TABLE stock_movements ALTER COLUMN value_after SET NOT NULL;
ALTER TABLE stock_movements ADD UNIQUE(tenant_id,document_type,document_id,document_line_id);
ALTER TABLE stock_movements ADD CHECK((document_type='RECEIPT' AND receipt_id IS NOT NULL AND line_id IS NOT NULL) OR (document_type<>'RECEIPT' AND receipt_id IS NULL AND line_id IS NULL));
CREATE INDEX stock_documents_site ON stock_documents(tenant_id,site_id,kind,id);
CREATE INDEX movements_history ON stock_movements(tenant_id,warehouse_id,sku_id,created_at DESC,sequence DESC);
