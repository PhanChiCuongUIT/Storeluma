-- Service-owned, revisioned snapshots for read-model subscribers.
-- Business mutation, snapshot revision and Outbox message commit atomically.
CREATE TABLE projection_records(kind text NOT NULL,id uuid NOT NULL,tenant_id uuid NOT NULL,site_id uuid,
 revision integer NOT NULL CHECK(revision>0),data jsonb NOT NULL,changed_at timestamptz NOT NULL,
 PRIMARY KEY(kind,id));
CREATE TABLE projection_snapshots(id uuid PRIMARY KEY,consumer text NOT NULL,as_of timestamptz NOT NULL,
 records jsonb NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX projection_snapshots_expiry ON projection_snapshots(expires_at);
CREATE VIEW projection_source AS
SELECT 'SKU'::text kind,q.* FROM (SELECT s.id,s.tenant_id,NULL::uuid site_id,jsonb_build_object('code',s.code,'name',s.name,'baseUnit',s.base_unit,'status',s.status) data FROM skus s) q;
CREATE FUNCTION capture_projection(p_kind text,p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE src record; saved record; eid uuid:=gen_random_uuid(); stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO src FROM projection_source WHERE kind=p_kind AND id=p_id;
 IF NOT FOUND THEN RETURN; END IF;
 INSERT INTO projection_records(kind,id,tenant_id,site_id,revision,data,changed_at)
 VALUES(src.kind,src.id,src.tenant_id,src.site_id,1,src.data,stamp)
 ON CONFLICT(kind,id) DO UPDATE SET revision=projection_records.revision+1,data=EXCLUDED.data,changed_at=EXCLUDED.changed_at
 WHERE projection_records.data IS DISTINCT FROM EXCLUDED.data
 RETURNING * INTO saved;
 IF NOT FOUND THEN RETURN; END IF;
 INSERT INTO outbox(id,type,payload) VALUES(eid,'catalog.projection-updated.v1',jsonb_build_object(
 'eventId',eid,'eventType','catalog.projection-updated.v1','schemaVersion',1,'occurredAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'producer','catalog-service','tenantId',saved.tenant_id,'siteId',saved.site_id,'aggregateId',saved.id,
 'aggregateType','Projection','aggregateVersion',saved.revision,'correlationId',saved.id,'causationId',saved.id,
 'data',jsonb_build_object('kind',saved.kind,'record',saved.data)));
END $$;
CREATE FUNCTION projection_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM capture_projection(TG_ARGV[0],NEW.id); RETURN NEW; END $$;
CREATE TRIGGER skus_projection AFTER INSERT OR UPDATE ON skus FOR EACH ROW EXECUTE FUNCTION projection_changed('SKU');
-- Existing business data is included without changing its documents or balances.
DO $$ DECLARE r record; BEGIN FOR r IN SELECT kind,id FROM projection_source ORDER BY kind,id LOOP PERFORM capture_projection(r.kind,r.id); END LOOP; END $$;
