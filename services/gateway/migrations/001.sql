CREATE TABLE sessions(id_hash text PRIMARY KEY,sealed text NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX session_expiry ON sessions(expires_at);
