ALTER TABLE shifts ADD COLUMN variance_approved_by text;
ALTER TABLE shifts ADD COLUMN variance_approved_at timestamptz;
ALTER TABLE shifts ADD COLUMN variance_approval_note varchar(500);
CREATE TABLE refunds (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, site_id uuid NOT NULL, return_id uuid NOT NULL, order_id uuid NOT NULL,
 payment_id uuid NOT NULL, shift_id uuid, amount_vnd numeric(20,0) NOT NULL CHECK(amount_vnd>=0),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SUCCEEDED')),
 version integer NOT NULL DEFAULT 1, confirmed_by text, confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,return_id), FOREIGN KEY(tenant_id,payment_id) REFERENCES payments(tenant_id,id),
 FOREIGN KEY(tenant_id,shift_id) REFERENCES shifts(tenant_id,id)
);
CREATE TABLE cash_entries (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, site_id uuid NOT NULL, shift_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('IN','OUT','REVERSAL')), amount_vnd numeric(20,0) NOT NULL CHECK(amount_vnd<>0),
 reason varchar(500) NOT NULL, created_by text NOT NULL, reversal_of uuid, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,reversal_of), FOREIGN KEY(tenant_id,shift_id) REFERENCES shifts(tenant_id,id),
 FOREIGN KEY(tenant_id,reversal_of) REFERENCES cash_entries(tenant_id,id)
);
ALTER TABLE cash_ledger ALTER COLUMN payment_id DROP NOT NULL;
ALTER TABLE cash_ledger DROP CONSTRAINT cash_ledger_amount_vnd_check;
ALTER TABLE cash_ledger ADD COLUMN refund_id uuid;
ALTER TABLE cash_ledger ADD COLUMN cash_entry_id uuid;
ALTER TABLE cash_ledger ADD CONSTRAINT cash_ledger_one_source CHECK(num_nonnulls(payment_id,refund_id,cash_entry_id)=1);
ALTER TABLE cash_ledger ADD UNIQUE(tenant_id,refund_id);
ALTER TABLE cash_ledger ADD UNIQUE(tenant_id,cash_entry_id);
ALTER TABLE cash_ledger ADD FOREIGN KEY(tenant_id,refund_id) REFERENCES refunds(tenant_id,id);
ALTER TABLE cash_ledger ADD FOREIGN KEY(tenant_id,cash_entry_id) REFERENCES cash_entries(tenant_id,id);
ALTER TABLE cash_ledger ADD CHECK((payment_id IS NULL OR amount_vnd>=0) AND (refund_id IS NULL OR amount_vnd<=0));
