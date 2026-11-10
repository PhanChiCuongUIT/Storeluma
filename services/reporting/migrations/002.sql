CREATE TABLE inbox(id uuid PRIMARY KEY,processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE outbox(id uuid PRIMARY KEY,type text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,delivered_at timestamptz);
CREATE TABLE idempotency(scope text NOT NULL,key text NOT NULL,body_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(scope,key));
CREATE TABLE audit(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,actor text NOT NULL,action text NOT NULL,entity_id uuid NOT NULL,before_data jsonb,after_data jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE read_records(producer text NOT NULL,kind text NOT NULL,id uuid NOT NULL,tenant_id uuid NOT NULL,site_id uuid,
 revision integer NOT NULL CHECK(revision>0),data jsonb NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(producer,kind,id));
CREATE INDEX read_records_scope ON read_records(tenant_id,kind,site_id,id);
CREATE TABLE projection_sync(producer text PRIMARY KEY,snapshot_id uuid,offset_value integer NOT NULL DEFAULT 0,as_of timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),last_error text,lease_token uuid,lease_until timestamptz);
INSERT INTO projection_sync(producer) VALUES('catalog'),('inventory'),('sales'),('finance');
UPDATE service_metadata SET stage='REPORTS_AND_EXPORTS';
CREATE TABLE report_exports(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,subject_id text NOT NULL,query jsonb NOT NULL,grant_scope jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','READY','FAILED')),file_name text,csv text,error text,
 data_as_of timestamptz,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',lease_token uuid,lease_until timestamptz);
CREATE INDEX report_exports_due ON report_exports(status,created_at);
