CREATE TABLE reservations (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,order_id uuid NOT NULL,site_id uuid NOT NULL,warehouse_id uuid NOT NULL,
 payment_id uuid NOT NULL,order_code text NOT NULL,actor_id text NOT NULL,request_hash text NOT NULL,amount_vnd numeric(20,0) NOT NULL CHECK(amount_vnd>=0),
 status text NOT NULL CHECK(status IN ('ACTIVE','PREPARED','COMMITTED','RELEASED','EXPIRED')),
 version integer NOT NULL DEFAULT 1,expires_at timestamptz NOT NULL,prepared_at timestamptz,committed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),result jsonb,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,order_id),UNIQUE(tenant_id,payment_id),
 FOREIGN KEY(tenant_id,warehouse_id) REFERENCES warehouses(tenant_id,id)
);
CREATE TABLE reservation_lines (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,reservation_id uuid NOT NULL,sku_id uuid NOT NULL,
 sku_code text NOT NULL,sku_name text NOT NULL,base_unit text NOT NULL,qty_base numeric(18,3) NOT NULL CHECK(qty_base>0),
 UNIQUE(tenant_id,reservation_id,sku_id),FOREIGN KEY(tenant_id,reservation_id) REFERENCES reservations(tenant_id,id)
);
CREATE INDEX reservations_expiry ON reservations(expires_at) WHERE status='ACTIVE';
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_document_type_check;
ALTER TABLE stock_movements ADD CHECK(document_type IN ('RECEIPT','COUNT','ADJUSTMENT','SALE'));
