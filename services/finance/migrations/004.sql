ALTER TABLE payments ADD CONSTRAINT payments_shift_tenant_fk
 FOREIGN KEY(tenant_id,shift_id) REFERENCES shifts(tenant_id,id);
