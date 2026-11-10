-- Service-owned, revisioned snapshots for read-model subscribers.
-- Business mutation, snapshot revision and Outbox message commit atomically.
CREATE TABLE projection_records(kind text NOT NULL,id uuid NOT NULL,tenant_id uuid NOT NULL,site_id uuid,
 revision integer NOT NULL CHECK(revision>0),data jsonb NOT NULL,changed_at timestamptz NOT NULL,
 PRIMARY KEY(kind,id));
CREATE TABLE projection_snapshots(id uuid PRIMARY KEY,consumer text NOT NULL,as_of timestamptz NOT NULL,
 records jsonb NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX projection_snapshots_expiry ON projection_snapshots(expires_at);
CREATE VIEW projection_source AS
SELECT 'MONEY'::text kind,q.* FROM (SELECT l.id,l.tenant_id,l.site_id,jsonb_build_object('shiftId',l.shift_id,'actorId',l.actor_id,'kind',CASE WHEN l.payment_id IS NOT NULL THEN 'PAYMENT' WHEN l.refund_id IS NOT NULL THEN 'REFUND' ELSE 'CASH_ENTRY' END,'sourceId',COALESCE(l.payment_id,l.refund_id,l.cash_entry_id),'amountVnd',l.amount_vnd::text,'occurredAt',l.created_at) data FROM cash_ledger l) q
UNION ALL
SELECT 'SHIFT'::text kind,q.* FROM (SELECT id,tenant_id,site_id,jsonb_build_object('actorId',cashier_id,'status',status,'openingVnd',opening_cash::text,'expectedVnd',expected_cash::text,'countedVnd',counted_cash::text,'differenceVnd',difference_vnd::text,'approvedAt',variance_approved_at,'openedAt',opened_at,'closedAt',closed_at) data FROM shifts) q
UNION ALL
SELECT 'PAYMENT'::text kind,q.* FROM (SELECT id,tenant_id,site_id,jsonb_build_object('actorId',actor_id,'orderId',order_id,'code',order_code,'status',status,'amountVnd',amount_vnd::text,'shiftId',shift_id,'createdAt',created_at) data FROM payments) q
UNION ALL
SELECT 'REFUND'::text kind,q.* FROM (SELECT f.id,f.tenant_id,f.site_id,jsonb_build_object('actorId',s.cashier_id,'returnId',f.return_id,'orderId',f.order_id,'status',f.status,'amountVnd',f.amount_vnd::text,'shiftId',f.shift_id,'createdAt',f.created_at) data FROM refunds f LEFT JOIN shifts s ON s.tenant_id=f.tenant_id AND s.id=f.shift_id) q;
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
 INSERT INTO outbox(id,type,payload) VALUES(eid,'finance.projection-updated.v1',jsonb_build_object(
 'eventId',eid,'eventType','finance.projection-updated.v1','schemaVersion',1,'occurredAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'producer','finance-service','tenantId',saved.tenant_id,'siteId',saved.site_id,'aggregateId',saved.id,
 'aggregateType','Projection','aggregateVersion',saved.revision,'correlationId',saved.id,'causationId',saved.id,
 'data',jsonb_build_object('kind',saved.kind,'record',saved.data)));
END $$;
CREATE FUNCTION projection_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM capture_projection(TG_ARGV[0],NEW.id); RETURN NEW; END $$;
CREATE TRIGGER cash_ledger_projection AFTER INSERT OR UPDATE ON cash_ledger FOR EACH ROW EXECUTE FUNCTION projection_changed('MONEY');
CREATE TRIGGER shifts_projection AFTER INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION projection_changed('SHIFT');
CREATE TRIGGER payments_projection AFTER INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION projection_changed('PAYMENT');
CREATE TRIGGER refunds_projection AFTER INSERT OR UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION projection_changed('REFUND');
-- Existing business data is included without changing its documents or balances.
DO $$ DECLARE r record; BEGIN FOR r IN SELECT kind,id FROM projection_source ORDER BY kind,id LOOP PERFORM capture_projection(r.kind,r.id); END LOOP; END $$;
