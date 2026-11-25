CREATE INDEX orders_customer_history ON orders (tenant_id, customer_id, site_id, created_at DESC, id DESC)
WHERE customer_id IS NOT NULL;
DROP INDEX orders_customer;
