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
UPDATE service_metadata SET stage='WORK_ITEMS_AND_ALERTS';
CREATE TABLE notification_rules(tenant_id uuid NOT NULL,site_id uuid NOT NULL,low_stock numeric(18,3) NOT NULL DEFAULT 5 CHECK(low_stock>=0),
 pending_minutes integer NOT NULL DEFAULT 15 CHECK(pending_minutes BETWEEN 1 AND 1440),version integer NOT NULL DEFAULT 1,PRIMARY KEY(tenant_id,site_id));
CREATE TABLE work_items(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,site_id uuid NOT NULL,kind text NOT NULL,source_id uuid NOT NULL,
 fingerprint text NOT NULL,title text NOT NULL,detail jsonb NOT NULL,actor_id text,status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),acknowledged_by text,acknowledged_at timestamptz,resolved_at timestamptz);
CREATE UNIQUE INDEX work_items_active ON work_items(tenant_id,fingerprint) WHERE status<>'RESOLVED';
CREATE INDEX work_items_scope ON work_items(tenant_id,site_id,status,created_at,id);

-- Read-model rules do not mutate source documents. Source changes clear work automatically.
CREATE VIEW work_candidates AS
SELECT r.tenant_id,r.site_id,'LOW_STOCK'::text kind,r.id source_id,NULL::text actor_id,
 'Sắp hết hàng: '||(sku.data->>'name') title,
 jsonb_build_object('screen','stock','sourceId',r.data->>'skuId','code',sku.data->>'code','available',r.data->>'available','threshold',COALESCE(rule.low_stock,5)::text,'baseUnit',sku.data->>'baseUnit') detail
FROM read_records r JOIN read_records sku ON sku.producer='catalog' AND sku.kind='SKU' AND sku.tenant_id=r.tenant_id AND sku.id=(r.data->>'skuId')::uuid
LEFT JOIN notification_rules rule ON rule.tenant_id=r.tenant_id AND rule.site_id=r.site_id
WHERE r.producer='inventory' AND r.kind='STOCK' AND sku.data->>'status'='ACTIVE' AND (r.data->>'available')::numeric<=COALESCE(rule.low_stock,5)
UNION ALL
SELECT r.tenant_id,r.site_id,'PAYMENT_PENDING',r.id,r.data->>'actorId','Chờ xác nhận tiền: '||(r.data->>'code'),
 jsonb_build_object('screen','orders','sourceId',r.data->>'orderId','code',r.data->>'code','amountVnd',r.data->>'amountVnd','since',r.data->>'createdAt')
FROM read_records r LEFT JOIN notification_rules rule ON rule.tenant_id=r.tenant_id AND rule.site_id=r.site_id
WHERE r.producer='finance' AND r.kind='PAYMENT' AND r.data->>'status'='PENDING' AND (r.data->>'createdAt')::timestamptz<now()-make_interval(mins=>COALESCE(rule.pending_minutes,15))
UNION ALL
SELECT r.tenant_id,r.site_id,'REFUND_PENDING',r.id,r.data->>'actorId','Khoản hoàn đang chờ xác nhận',
 jsonb_build_object('screen','returns','sourceId',r.data->>'returnId','orderId',r.data->>'orderId','amountVnd',r.data->>'amountVnd','since',r.data->>'createdAt')
FROM read_records r LEFT JOIN notification_rules rule ON rule.tenant_id=r.tenant_id AND rule.site_id=r.site_id
WHERE r.producer='finance' AND r.kind='REFUND' AND r.data->>'status'='PENDING' AND (r.data->>'createdAt')::timestamptz<now()-make_interval(mins=>COALESCE(rule.pending_minutes,15))
UNION ALL
SELECT tenant_id,site_id,'ORDER_REVIEW',id,data->>'actorId','Cần kiểm tra đơn: '||(data->>'code'),
 jsonb_build_object('screen','orders','sourceId',id,'code',data->>'code','since',data->>'createdAt')
FROM read_records WHERE producer='sales' AND kind='ORDER' AND data->>'status'='REVIEW'
UNION ALL
SELECT tenant_id,site_id,'RETURN_APPROVAL',id,data->>'actorId','Phiếu trả chờ duyệt: '||(data->>'code'),
 jsonb_build_object('screen','returns','sourceId',id,'orderId',data->>'orderId','code',data->>'code','since',data->>'createdAt')
FROM read_records WHERE producer='sales' AND kind='RETURN' AND data->>'status'='REQUESTED'
UNION ALL
SELECT tenant_id,site_id,'SHIFT_VARIANCE',id,data->>'actorId','Ca bán có chênh lệch chưa xác nhận',
 jsonb_build_object('screen','drawer','sourceId',id,'differenceVnd',data->>'differenceVnd','since',data->>'closedAt')
FROM read_records WHERE producer='finance' AND kind='SHIFT' AND data->>'status'='CLOSED' AND (data->>'differenceVnd')::numeric<>0 AND data->>'approvedAt' IS NULL;
