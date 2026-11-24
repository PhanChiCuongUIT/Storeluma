CREATE TABLE reconciliation_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,site_id uuid NOT NULL,
 saga_id uuid NOT NULL UNIQUE,order_id uuid NOT NULL,return_id uuid,payment_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','INVESTIGATING','RESOLVED')),
 stage text NOT NULL,last_error text,version int NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,order_id) REFERENCES orders(tenant_id,id),FOREIGN KEY(tenant_id,return_id) REFERENCES returns(tenant_id,id)
);
CREATE INDEX cases_site ON reconciliation_cases(tenant_id,site_id,updated_at);
CREATE FUNCTION record_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc record;
BEGIN
 IF NEW.last_error IS NOT NULL THEN
  IF TG_TABLE_NAME='checkout_sagas' THEN
   SELECT NEW.site_id site, NEW.order_id ord, NULL::uuid ret, NEW.payment_id pay INTO doc;
  ELSE
   SELECT site_id site,order_id ord,id ret,refund_id pay INTO doc FROM returns WHERE tenant_id=NEW.tenant_id AND id=NEW.return_id;
  END IF;
  INSERT INTO reconciliation_cases(tenant_id,site_id,saga_id,order_id,return_id,payment_id,stage,last_error)
   VALUES(NEW.tenant_id,doc.site,NEW.id,doc.ord,doc.ret,doc.pay,NEW.stage,NEW.last_error)
   ON CONFLICT(saga_id) DO UPDATE SET stage=EXCLUDED.stage,last_error=EXCLUDED.last_error,updated_at=clock_timestamp(),
    version=reconciliation_cases.version+1 WHERE (reconciliation_cases.stage,reconciliation_cases.last_error) IS DISTINCT FROM (EXCLUDED.stage,EXCLUDED.last_error);
 ELSE
  UPDATE reconciliation_cases SET stage=NEW.stage,status=CASE WHEN NEW.stage='DONE' THEN 'RESOLVED' ELSE status END,
    version=version+1,updated_at=clock_timestamp() WHERE saga_id=NEW.id AND stage IS DISTINCT FROM NEW.stage;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checkout_case AFTER UPDATE OF stage,last_error ON checkout_sagas FOR EACH ROW EXECUTE FUNCTION record_reconciliation();
CREATE TRIGGER return_case AFTER UPDATE OF stage,last_error ON return_sagas FOR EACH ROW EXECUTE FUNCTION record_reconciliation();
UPDATE checkout_sagas SET last_error=last_error WHERE last_error IS NOT NULL AND stage<>'DONE';
UPDATE return_sagas SET last_error=last_error WHERE last_error IS NOT NULL AND stage<>'DONE';
