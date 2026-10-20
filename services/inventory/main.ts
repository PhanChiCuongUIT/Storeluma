import {migrate,outbox} from '../../packages/platform/db.js';
import {worker} from '../../packages/platform/bus.js';
import {start} from '../../packages/platform/http.js';
import {Inventory} from './inventory.js';
import {Stock} from './stock.js';
await migrate('inventory');
await worker('inventory',['site.provision.requested','catalog.sku-updated.v1'],async(c,e)=>{
  if('data' in e){if(e.eventType!=='catalog.sku-updated.v1'||e.producer!=='catalog-service')throw new Error('Unexpected catalog event');const d=e.data;await c.query('INSERT INTO sku_projection(tenant_id,sku_id,code,name,base_unit,status,version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,sku_id) DO UPDATE SET code=excluded.code,name=excluded.name,base_unit=excluded.base_unit,status=excluded.status,version=excluded.version WHERE sku_projection.version<excluded.version',[e.tenantId,d.skuId,d.code,d.name,d.baseUnit,d.status,d.version]);return;}
  await c.query('INSERT INTO warehouses(id,tenant_id,site_id,name) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[e.warehouseId,e.tenantId,e.siteId,'Kho chính']);
  const row=(await c.query('SELECT * FROM warehouses WHERE id=$1',[e.warehouseId])).rows[0];
  if(row.tenant_id!==e.tenantId||row.site_id!==e.siteId)throw new Error('Provision identity conflict');
  await outbox(c,'warehouse.ready',{tenantId:e.tenantId,siteId:e.siteId,warehouseId:e.warehouseId,registerId:e.registerId});
});
await start([Inventory,Stock]);
