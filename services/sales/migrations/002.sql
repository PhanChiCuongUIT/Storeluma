UPDATE service_metadata SET stage='ORDERS_AND_CHECKOUT';
CREATE TABLE quotes (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,site_id uuid NOT NULL,warehouse_id uuid NOT NULL,created_by text NOT NULL,
 request jsonb NOT NULL,lines jsonb NOT NULL,subtotal_vnd numeric(20,0) NOT NULL CHECK(subtotal_vnd>=0),discount_vnd numeric(20,0) NOT NULL CHECK(discount_vnd>=0),
 payable_vnd numeric(20,0) NOT NULL CHECK(payable_vnd>=0),pricing_hash text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id)
);
CREATE TABLE orders (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,site_id uuid NOT NULL,warehouse_id uuid NOT NULL,quote_id uuid NOT NULL,code text NOT NULL,
 created_by text NOT NULL,note varchar(500) NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING','COMMITTING','REVIEW','COMPLETED','CANCELLED')),
 version integer NOT NULL DEFAULT 1,lines jsonb NOT NULL,subtotal_vnd numeric(20,0) NOT NULL,discount_vnd numeric(20,0) NOT NULL,payable_vnd numeric(20,0) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,cancel_reason text,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,quote_id),UNIQUE(tenant_id,code),FOREIGN KEY(tenant_id,quote_id) REFERENCES quotes(tenant_id,id)
);
CREATE INDEX orders_site ON orders(tenant_id,site_id,id);
CREATE TABLE checkout_sagas (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,order_id uuid NOT NULL,site_id uuid NOT NULL,actor_id text NOT NULL,
 reservation_id uuid NOT NULL,payment_id uuid NOT NULL,shift_id uuid NOT NULL,tendered_vnd numeric(20,0) NOT NULL,
 stage text NOT NULL CHECK(stage IN ('RESERVE','PREPARE','PAYMENT','COMMIT','COMPLETE','CANCEL','DONE')),
 cancel_requested boolean NOT NULL DEFAULT false,cancel_reason text,payment jsonb,stock_result jsonb,
 last_error text,attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,order_id),UNIQUE(tenant_id,reservation_id),UNIQUE(tenant_id,payment_id),FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id)
);
CREATE INDEX checkout_due ON checkout_sagas(next_attempt_at) WHERE stage<>'DONE';
CREATE TABLE idempotency(scope text NOT NULL,key text NOT NULL,body_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(scope,key));
CREATE TABLE audit(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,actor text NOT NULL,action text NOT NULL,entity_id uuid NOT NULL,before_data jsonb,after_data jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE inbox(id uuid PRIMARY KEY,processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE outbox(id uuid PRIMARY KEY,type text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,delivered_at timestamptz);
