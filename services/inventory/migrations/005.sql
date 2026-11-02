ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_document_type_check;
ALTER TABLE stock_movements ADD CHECK(document_type IN ('RECEIPT','COUNT','ADJUSTMENT','SALE','RETURN'));
CREATE TABLE return_receipts (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL, site_id uuid NOT NULL, warehouse_id uuid NOT NULL,
 request_hash text NOT NULL, lines jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,warehouse_id) REFERENCES warehouses(tenant_id,id)
);
