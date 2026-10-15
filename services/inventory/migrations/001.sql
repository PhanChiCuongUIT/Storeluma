CREATE TABLE warehouses(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,site_id uuid NOT NULL UNIQUE,name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE inbox(id uuid PRIMARY KEY,processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE outbox(id uuid PRIMARY KEY,type text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,delivered_at timestamptz);
