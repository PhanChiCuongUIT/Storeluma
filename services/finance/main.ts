import {migrate,outbox} from '../../packages/platform/db.js';
import {worker} from '../../packages/platform/bus.js';
import {start} from '../../packages/platform/http.js';
import {randomUUID} from 'node:crypto';
import {Finance} from './finance.js';
await migrate('finance');
await worker('finance',['site.provision.requested','inventory.receipt-posted.v1'],async(c,e)=>{
  if('data' in e){if(e.eventType!=='inventory.receipt-posted.v1'||e.producer!=='inventory-service')throw new Error('Unexpected receipt event');const d=e.data;if(d.sourceType==='OPENING_STOCK')return;if(!e.siteId||!d.supplierId||!d.supplierName)throw new Error('Purchase identity missing');await c.query('INSERT INTO payables(id,tenant_id,site_id,receipt_id,supplier_id,supplier_name,total_vnd,source_event_id,posted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,receipt_id) DO NOTHING',[randomUUID(),e.tenantId,e.siteId,d.receiptId,d.supplierId,d.supplierName,d.totalVnd,e.eventId,d.postedAt]);const row=(await c.query('SELECT * FROM payables WHERE tenant_id=$1 AND receipt_id=$2',[e.tenantId,d.receiptId])).rows[0];if(row.total_vnd!==d.totalVnd||row.supplier_id!==d.supplierId||row.site_id!==e.siteId)throw new Error('Receipt identity conflict');return;}
  await c.query('INSERT INTO registers(id,tenant_id,site_id,name) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[e.registerId,e.tenantId,e.siteId,'Quầy chính']);
  const row=(await c.query('SELECT * FROM registers WHERE id=$1',[e.registerId])).rows[0];
  if(row.tenant_id!==e.tenantId||row.site_id!==e.siteId)throw new Error('Provision identity conflict');
  await outbox(c,'register.ready',{tenantId:e.tenantId,siteId:e.siteId,warehouseId:e.warehouseId,registerId:e.registerId});
});
await start([Finance]);
