CREATE TABLE customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
 name varchar(120) NOT NULL, phone varchar(32), email varchar(254), note varchar(500) NOT NULL DEFAULT '',
 marketing_consent boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','ANONYMIZED')),
 version integer NOT NULL DEFAULT 1, UNIQUE(tenant_id,id)
);
CREATE INDEX customers_name ON customers(tenant_id,lower(name));
CREATE INDEX customers_phone ON customers(tenant_id,phone);
ALTER TABLE quotes ADD COLUMN customer_id uuid, ADD COLUMN customer_snapshot jsonb,
 ADD FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id);
ALTER TABLE orders ADD COLUMN customer_id uuid, ADD COLUMN customer_snapshot jsonb,
 ADD FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id);
CREATE INDEX orders_customer ON orders(tenant_id,customer_id,site_id,id);
