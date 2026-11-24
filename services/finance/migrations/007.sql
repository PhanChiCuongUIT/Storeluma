CREATE TABLE cash_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, site_id uuid NOT NULL,
 code varchar(64) NOT NULL, name varchar(120) NOT NULL, kind text NOT NULL CHECK(kind IN ('DRAWER','CASH','BANK')),
 register_id uuid, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,code), UNIQUE(tenant_id,register_id),
 FOREIGN KEY(tenant_id,register_id) REFERENCES registers(tenant_id,id), CHECK((register_id IS NOT NULL)=(kind='DRAWER'))
);
CREATE FUNCTION drawer_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO cash_accounts(tenant_id,site_id,code,name,kind,register_id)
 VALUES(NEW.tenant_id,NEW.site_id,'DRAWER-'||NEW.id,NEW.name,'DRAWER',NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER register_account AFTER INSERT ON registers FOR EACH ROW EXECUTE FUNCTION drawer_account();
INSERT INTO cash_accounts(tenant_id,site_id,code,name,kind,register_id)
 SELECT tenant_id,site_id,'DRAWER-'||id,name,'DRAWER',id FROM registers;
ALTER TABLE payables ADD UNIQUE(tenant_id,id);
CREATE TABLE supplier_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,site_id uuid NOT NULL,supplier_id uuid NOT NULL,
 account_id uuid NOT NULL,shift_id uuid,amount_vnd numeric(20,0) NOT NULL CHECK(amount_vnd>0),
 reference varchar(120) NOT NULL,reason varchar(500) NOT NULL,posted_by text NOT NULL,
 posted_at timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED','REVERSED')),
 reversal_of uuid,UNIQUE(tenant_id,id),UNIQUE(tenant_id,reversal_of),
 FOREIGN KEY(tenant_id,reversal_of) REFERENCES supplier_payments(tenant_id,id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES cash_accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,shift_id) REFERENCES shifts(tenant_id,id)
);
CREATE TABLE payable_allocations (
 tenant_id uuid NOT NULL,payment_id uuid NOT NULL,payable_id uuid NOT NULL,amount_vnd numeric(20,0) NOT NULL CHECK(amount_vnd>0),
 PRIMARY KEY(tenant_id,payment_id,payable_id), FOREIGN KEY(tenant_id,payment_id) REFERENCES supplier_payments(tenant_id,id),
 FOREIGN KEY(tenant_id,payable_id) REFERENCES payables(tenant_id,id)
);
ALTER TABLE cash_entries ALTER COLUMN shift_id DROP NOT NULL, ADD COLUMN account_id uuid,
 ADD FOREIGN KEY(tenant_id,account_id) REFERENCES cash_accounts(tenant_id,id),
 ADD CHECK(shift_id IS NOT NULL OR account_id IS NOT NULL);
ALTER TABLE cash_ledger DROP CONSTRAINT cash_ledger_one_source, ALTER COLUMN shift_id DROP NOT NULL,
 ADD COLUMN supplier_payment_id uuid, ADD COLUMN account_id uuid,
 ADD UNIQUE(tenant_id,supplier_payment_id), ADD FOREIGN KEY(tenant_id,supplier_payment_id) REFERENCES supplier_payments(tenant_id,id),
 ADD FOREIGN KEY(tenant_id,account_id) REFERENCES cash_accounts(tenant_id,id),
 ADD CHECK(num_nonnulls(payment_id,refund_id,cash_entry_id,supplier_payment_id)=1), ADD CHECK(shift_id IS NOT NULL OR account_id IS NOT NULL);
ALTER VIEW projection_source RENAME TO projection_sources_v1;
CREATE VIEW projection_source AS SELECT * FROM projection_sources_v1 WHERE kind<>'MONEY'
UNION ALL SELECT 'MONEY',l.id,l.tenant_id,l.site_id,jsonb_build_object(
 'shiftId',l.shift_id,'actorId',l.actor_id,'kind',CASE WHEN l.payment_id IS NOT NULL THEN 'PAYMENT' WHEN l.refund_id IS NOT NULL THEN 'REFUND'
 WHEN l.supplier_payment_id IS NOT NULL THEN 'SUPPLIER_PAYMENT' ELSE 'CASH_ENTRY' END,
 'sourceId',COALESCE(l.payment_id,l.refund_id,l.cash_entry_id,l.supplier_payment_id),'amountVnd',l.amount_vnd::text,'occurredAt',l.created_at) FROM cash_ledger l;
