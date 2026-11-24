CREATE TABLE dead_letters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),fingerprint text NOT NULL UNIQUE,event_id uuid,event_type text,tenant_id uuid,
 reason text NOT NULL,payload jsonb,status text NOT NULL DEFAULT 'PARKED' CHECK(status IN ('PARKED','REQUESTED','PROCESSED')),
 version int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz
);
CREATE INDEX dead_letter_requests ON dead_letters(id) WHERE status='REQUESTED';
CREATE TABLE replay_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),letter_id uuid NOT NULL REFERENCES dead_letters(id),
 actor text NOT NULL,reason varchar(500) NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE tenants ADD COLUMN operational_status text NOT NULL DEFAULT 'ACTIVE' CHECK(operational_status IN ('ACTIVE','SUSPENDED')), ADD COLUMN version int NOT NULL DEFAULT 1;
CREATE TABLE support_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),operator_subject uuid NOT NULL,
 site_ids uuid[] NOT NULL,actions text[] NOT NULL,reason varchar(500) NOT NULL,granted_by text NOT NULL,
 expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_active ON support_grants(tenant_id,operator_subject,expires_at) WHERE revoked_at IS NULL;
