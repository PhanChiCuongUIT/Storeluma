CREATE TABLE dead_letters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),fingerprint text NOT NULL UNIQUE,event_id uuid,event_type text,tenant_id uuid,
 reason text NOT NULL,payload jsonb,status text NOT NULL DEFAULT 'PARKED' CHECK(status IN ('PARKED','REQUESTED','PROCESSED')),
 version int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz
);
CREATE INDEX dead_letter_requests ON dead_letters(id) WHERE status='REQUESTED';
CREATE TABLE replay_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),letter_id uuid NOT NULL REFERENCES dead_letters(id),
 actor text NOT NULL,reason varchar(500) NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
