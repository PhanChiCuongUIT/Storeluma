CREATE TABLE returns (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, order_id uuid NOT NULL, site_id uuid NOT NULL,
 warehouse_id uuid NOT NULL, payment_id uuid NOT NULL, refund_id uuid NOT NULL, code text NOT NULL,
 status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','APPROVED','REFUND_PENDING','COMPLETED','CANCELLED')),
 lines jsonb NOT NULL, amount_vnd numeric(20,0) NOT NULL CHECK(amount_vnd>=0), reason varchar(500) NOT NULL,
 created_by text NOT NULL, approved_by text, approval_note varchar(500), late_return boolean NOT NULL,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz, completed_at timestamptz,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,code), UNIQUE(tenant_id,refund_id), FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id)
);
-- Serialise partial returns for deterministic cumulative rounding and safe cancellation.
CREATE UNIQUE INDEX returns_one_active ON returns(tenant_id,order_id) WHERE status NOT IN ('COMPLETED','CANCELLED');
CREATE TABLE return_sagas (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, return_id uuid NOT NULL, stage text NOT NULL CHECK(stage IN ('RECEIVE','REFUND','DONE')),
 refund jsonb, last_error varchar(500), attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz, UNIQUE(tenant_id,return_id), FOREIGN KEY(tenant_id,return_id) REFERENCES returns(tenant_id,id)
);
CREATE INDEX return_sagas_due ON return_sagas(next_attempt_at) WHERE stage<>'DONE';
CREATE TABLE receipts (
 tenant_id uuid NOT NULL, order_id uuid NOT NULL, snapshot jsonb NOT NULL, print_count integer NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,order_id), FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id)
);
