import {migrate,outbox} from '../../packages/platform/db.js';
import {worker} from '../../packages/platform/bus.js';
import {start} from '../../packages/platform/http.js';
await migrate('finance');
await worker('finance',['site.provision.requested'],async(c,e)=>{
  await c.query('INSERT INTO registers(id,tenant_id,site_id,name) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[e.registerId,e.tenantId,e.siteId,'Quầy chính']);
  const row=(await c.query('SELECT * FROM registers WHERE id=$1',[e.registerId])).rows[0];
  if(row.tenant_id!==e.tenantId||row.site_id!==e.siteId)throw new Error('Provision identity conflict');
  await outbox(c,'register.ready',{tenantId:e.tenantId,siteId:e.siteId,warehouseId:e.warehouseId,registerId:e.registerId});
});
await start();
