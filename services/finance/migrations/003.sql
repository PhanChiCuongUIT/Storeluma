ALTER TABLE registers ADD UNIQUE(tenant_id,id);
CREATE TABLE shifts (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,site_id uuid NOT NULL,register_id uuid NOT NULL,cashier_id text NOT NULL,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
 opening_cash numeric(20,0) NOT NULL CHECK(opening_cash>=0),expected_cash numeric(20,0),counted_cash numeric(20,0) CHECK(counted_cash>=0),
 difference_vnd numeric(21,0),close_note text,version integer NOT NULL DEFAULT 1,opened_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz,
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,register_id) REFERENCES registers(tenant_id,id)
);
CREATE UNIQUE INDEX shifts_one_open ON shifts(register_id) WHERE status='OPEN';
CREATE TABLE payments (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,site_id uuid NOT NULL,order_id uuid NOT NULL,reservation_id uuid NOT NULL,
 shift_id uuid NOT NULL,actor_id text NOT NULL,order_code text NOT NULL,
 amount_vnd numeric(20,0) NOT NULL CHECK(amount_vnd>=0),tendered_vnd numeric(20,0) NOT NULL CHECK(tendered_vnd>=amount_vnd),
 status text NOT NULL CHECK(status IN ('PENDING','SUCCEEDED','FAILED')),version integer NOT NULL DEFAULT 1,
 confirmed_by text,confirmed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,order_id),UNIQUE(tenant_id,reservation_id)
);
CREATE TABLE cash_ledger (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,site_id uuid NOT NULL,shift_id uuid NOT NULL,payment_id uuid NOT NULL,
 amount_vnd numeric(20,0) NOT NULL CHECK(amount_vnd>=0),actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,payment_id),FOREIGN KEY(tenant_id,shift_id) REFERENCES shifts(tenant_id,id),FOREIGN KEY(tenant_id,payment_id) REFERENCES payments(tenant_id,id)
);
CREATE TABLE idempotency(scope text NOT NULL,key text NOT NULL,body_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(scope,key));
CREATE TABLE audit(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,actor text NOT NULL,action text NOT NULL,entity_id uuid NOT NULL,before_data jsonb,after_data jsonb,created_at timestamptz NOT NULL DEFAULT now());
