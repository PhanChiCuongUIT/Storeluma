import 'reflect-metadata';
import {Controller,Get,Post,Patch,Body,Param,Req,Headers,ForbiddenException,NotFoundException,ConflictException,BadRequestException} from '@nestjs/common';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {db,migrate,transaction,outbox} from '../../packages/platform/db.js';
import {start,type ActorRequest} from '../../packages/platform/http.js';
import {worker} from '../../packages/platform/bus.js';
import {verifyService} from '../../packages/platform/service-client.js';
const text=z.string().trim().min(1).max(120);
const siteInput=z.object({code:z.string().regex(/^[A-Z0-9_-]{2,32}$/),name:text,address:z.string().trim().max(250).default('')}).strict();
const memberRoles=z.enum(['MANAGER','CASHIER','STOCK','ACCOUNTANT']);
type Queryable=Pick<PoolClient,'query'>;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
async function membership(c:Queryable,sub:string,tenant:string,owner=false){
  z.uuid().parse(tenant);
  const m=(await c.query('SELECT * FROM memberships WHERE tenant_id=$1 AND subject_id=$2',[tenant,sub])).rows[0];
  if(!m)throw new NotFoundException('Không tìm thấy hộ trong phạm vi được giao.');
  if(m.status!=='ACTIVE')throw new ForbiddenException('Quyền thành viên đã bị khóa.');
  if(owner&&m.role!=='OWNER')throw new ForbiddenException('Chỉ chủ hộ được thực hiện thao tác này.');
  return m;
}
async function siteAccess(c:Queryable,sub:string,tenant:string,id:string){
  z.uuid().parse(id);const m=await membership(c,sub,tenant);
  const s=(await c.query('SELECT * FROM sites WHERE tenant_id=$1 AND id=$2',[tenant,id])).rows[0];
  if(!s||(m.role!=='OWNER'&&!m.site_ids.includes(id)))throw new NotFoundException('Không tìm thấy địa điểm trong phạm vi được giao.');
  return {m,s};
}
async function audit(c:PoolClient,tenant:string,actor:string,action:string,entity:string,before:unknown,after:unknown){
  await c.query('INSERT INTO audit(id,tenant_id,actor,action,entity_id,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),tenant,actor,action,entity,before,after]);
}
async function idem(c:PoolClient,scope:string,key:string,body:unknown,fn:()=>Promise<unknown>){
  z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).parse(key);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope+':'+key]);
  const digest=hash(JSON.stringify(body));
  const previous=(await c.query('SELECT * FROM idempotency WHERE scope=$1 AND key=$2',[scope,key])).rows[0];
  if(previous){if(previous.body_hash!==digest)throw new ConflictException('Mã thao tác đã dùng với nội dung khác.');return previous.response;}
  const result=await fn();
  await c.query('INSERT INTO idempotency(scope,key,body_hash,response) VALUES($1,$2,$3,$4)',[scope,key,digest,result]);return result;
}
async function createSite(c:PoolClient,tenantId:string,input:z.infer<typeof siteInput>){
  const s={id:randomUUID(),tenantId,warehouseId:randomUUID(),registerId:randomUUID()};
  await c.query('INSERT INTO sites(id,tenant_id,code,name,address,status,warehouse_id,register_id) VALUES($1,$2,$3,$4,$5,\'PROVISIONING\',$6,$7)',[s.id,tenantId,input.code,input.name,input.address,s.warehouseId,s.registerId]);
  await outbox(c,'site.provision.requested',{tenantId,siteId:s.id,warehouseId:s.warehouseId,registerId:s.registerId});
  return (await c.query('SELECT * FROM sites WHERE id=$1',[s.id])).rows[0];
}
@Controller('v1')
class Business{
  @Post('internal/authorize')async authorize(@Req()r:ActorRequest,@Body()body:unknown){
    await verifyService(r,['catalog','inventory','finance','sales']);
    const input=z.object({tenantId:z.uuid(),siteId:z.uuid().optional(),action:z.enum(['catalog.read','catalog.write','supplier.read','supplier.write','receipt.read','receipt.write','receipt.post','receipt.opening','stock.read','payable.read','stock.count.read','stock.count.write','stock.count.approve','stock.count.cancel','stock.adjust.read','stock.adjust.write','stock.adjust.approve','stock.adjust.cancel','sale.read','sale.write','sale.checkout','sale.cancel','shift.read','shift.open','shift.close','payment.confirm'])}).strict().parse(body);
    const m=await membership(db,r.actor.sub!,input.tenantId);
    const roles:Record<string,string[]>={
      'sale.read':['OWNER','MANAGER','CASHIER','ACCOUNTANT'],'sale.write':['OWNER','MANAGER','CASHIER'],'sale.checkout':['OWNER','MANAGER','CASHIER'],'sale.cancel':['OWNER','MANAGER','CASHIER'],
      'shift.read':['OWNER','MANAGER','CASHIER','ACCOUNTANT'],'shift.open':['OWNER','MANAGER','CASHIER'],'shift.close':['OWNER','MANAGER','CASHIER'],'payment.confirm':['OWNER','MANAGER','CASHIER'],
      'catalog.read':['OWNER','MANAGER','CASHIER','STOCK','ACCOUNTANT'],'catalog.write':['OWNER','MANAGER'],
      'supplier.read':['OWNER','MANAGER','STOCK','ACCOUNTANT'],'supplier.write':['OWNER','MANAGER','STOCK'],
      'receipt.read':['OWNER','MANAGER','STOCK','ACCOUNTANT'],'receipt.write':['OWNER','MANAGER','STOCK'],
      'receipt.post':['OWNER','MANAGER'],'receipt.opening':['OWNER'],'stock.read':['OWNER','MANAGER','CASHIER','STOCK','ACCOUNTANT'],'payable.read':['OWNER','ACCOUNTANT'],'stock.count.read':['OWNER','MANAGER','STOCK','ACCOUNTANT'],'stock.count.write':['OWNER','MANAGER','STOCK'],'stock.count.approve':['OWNER','MANAGER'],'stock.count.cancel':['OWNER','MANAGER','STOCK'],'stock.adjust.read':['OWNER','MANAGER','STOCK','ACCOUNTANT'],'stock.adjust.write':['OWNER','MANAGER','STOCK'],'stock.adjust.approve':['OWNER','MANAGER'],'stock.adjust.cancel':['OWNER','MANAGER','STOCK']
    };
    if(!roles[input.action].includes(m.role))throw new ForbiddenException('Vai trò hiện tại không được thực hiện thao tác này.');
    let site;
    if(input.siteId){const result=await siteAccess(db,r.actor.sub!,input.tenantId,input.siteId);site=result.s;
      if(/write|post|opening|approve|checkout|shift.open|payment.confirm/.test(input.action)&&site.status!=='ACTIVE')throw new ConflictException('Địa điểm chưa sẵn sàng hoặc đã tạm ngừng.');
    }
    if(!input.siteId&&m.role!=='OWNER'&&/write/.test(input.action)){
      if(!(await db.query("SELECT 1 FROM sites WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE' LIMIT 1",[input.tenantId,m.site_ids])).rowCount)throw new ForbiddenException('Không có địa điểm hoạt động trong phạm vi.');
    }
    return {role:m.role,siteIds:m.site_ids,warehouseId:site?.warehouse_id,registerId:site?.register_id,siteName:site?.name,costRead:['OWNER','ACCOUNTANT'].includes(m.role),permissionVersion:m.version};
  }
  @Get('me')async me(@Req()r:ActorRequest){
    const memberships=(await db.query(`SELECT m.*,t.name AS tenant_name FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE subject_id=$1 ORDER BY t.created_at`,[r.actor.sub])).rows;
    return {subjectId:r.actor.sub,username:r.actor.preferred_username,memberships};
  }
  @Post('tenants')async tenant(@Req()r:ActorRequest,@Body()body:unknown,@Headers('idempotency-key')key:string){
    const input=z.object({name:text,contact:z.string().trim().max(250).default(''),site:siteInput}).strict().parse(body);
    return transaction(c=>idem(c,`${r.actor.sub}:tenant.create`,key,input,async()=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[r.actor.sub!]);
      if(Number((await c.query('SELECT count(*) FROM memberships WHERE subject_id=$1 AND role=\'OWNER\'',[r.actor.sub])).rows[0].count)>=20)throw new ConflictException('Bạn đã đạt giới hạn số hộ kinh doanh được tạo.');
      const tenantId=randomUUID();await c.query('INSERT INTO tenants(id,name,contact) VALUES($1,$2,$3)',[tenantId,input.name,input.contact]);
      await c.query('INSERT INTO memberships(id,tenant_id,subject_id,role,status) VALUES($1,$2,$3,\'OWNER\',\'ACTIVE\')',[randomUUID(),tenantId,r.actor.sub]);
      const site=await createSite(c,tenantId,input.site);
      await audit(c,tenantId,r.actor.sub!,'TENANT_CREATED',tenantId,null,{name:input.name,method:'AUTHENTICATED_BOOTSTRAP'});
      return {tenantId,site};
    }));
  }
  @Get('tenants/:tenantId/sites')async sites(@Req()r:ActorRequest,@Param('tenantId')tenant:string){
    const m=await membership(db,r.actor.sub!,tenant);
    return (await db.query('SELECT * FROM sites WHERE tenant_id=$1 AND ($2 OR id=ANY($3::uuid[])) ORDER BY created_at',[tenant,m.role==='OWNER',m.site_ids])).rows;
  }
  @Get('tenants/:tenantId/sites/:siteId')async site(@Req()r:ActorRequest,@Param('tenantId')tenant:string,@Param('siteId')id:string){return (await siteAccess(db,r.actor.sub!,tenant,id)).s;}
  @Post('tenants/:tenantId/sites')async addSite(@Req()r:ActorRequest,@Param('tenantId')tenant:string,@Body()body:unknown,@Headers('idempotency-key')key:string){
    const input=siteInput.parse(body);
    return transaction(async c=>{await membership(c,r.actor.sub!,tenant,true);return idem(c,`${r.actor.sub}:site.create:${tenant}`,key,input,async()=>{
      const site=await createSite(c,tenant,input);await audit(c,tenant,r.actor.sub!,'SITE_CREATED',site.id,null,site);return site;
    });});
  }
  @Patch('tenants/:tenantId/sites/:siteId')async updateSite(@Req()r:ActorRequest,@Param('tenantId')tenant:string,@Param('siteId')id:string,@Body()body:unknown){
    const input=z.object({name:text,address:z.string().trim().max(250),status:z.enum(['ACTIVE','SUSPENDED']),version:z.number().int().positive()}).strict().parse(body);
    return transaction(async c=>{
      const {m,s}=await siteAccess(c,r.actor.sub!,tenant,id);
      if(!['OWNER','MANAGER'].includes(m.role))throw new ForbiddenException('Không có quyền sửa địa điểm.');
      if(!s.warehouse_ready||!s.register_ready)throw new ConflictException('Kho và quầy chưa sẵn sàng.');
      const updated=(await c.query('UPDATE sites SET name=$1,address=$2,status=$3,version=version+1 WHERE id=$4 AND tenant_id=$5 AND version=$6 RETURNING *',[input.name,input.address,input.status,id,tenant,input.version])).rows[0];
      if(!updated)throw new ConflictException('Dữ liệu đã đổi. Vui lòng tải lại.');
      await audit(c,tenant,r.actor.sub!,'SITE_UPDATED',id,s,updated);return updated;
    });
  }
  @Post('context')async context(@Req()r:ActorRequest,@Body()body:unknown){
    const input=z.object({tenantId:z.uuid(),siteId:z.uuid()}).strict().parse(body);
    const {m,s}=await siteAccess(db,r.actor.sub!,input.tenantId,input.siteId);
    if(s.status!=='ACTIVE')throw new ConflictException('Địa điểm chưa sẵn sàng hoặc đã tạm ngừng.');
    return {...input,role:m.role,siteName:s.name};
  }
  @Get('tenants/:tenantId/memberships')async staff(@Req()r:ActorRequest,@Param('tenantId')tenant:string){await membership(db,r.actor.sub!,tenant,true);return (await db.query('SELECT * FROM memberships WHERE tenant_id=$1 ORDER BY role,subject_id',[tenant])).rows;}
  @Post('tenants/:tenantId/invitations')async invite(@Req()r:ActorRequest,@Param('tenantId')tenant:string,@Body()body:unknown){
    const input=z.object({targetSubjectId:z.uuid(),role:memberRoles,siteIds:z.array(z.uuid()).min(1).max(30),ownerConfirmed:z.literal(true)}).strict().parse(body);
    if(input.targetSubjectId===r.actor.sub)throw new BadRequestException('Không tự mời chính mình.');
    return transaction(async c=>{
      await membership(c,r.actor.sub!,tenant,true);
      const unique=[...new Set(input.siteIds)];
      const sites=await c.query('SELECT id FROM sites WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[tenant,unique]);
      if(sites.rowCount!==unique.length)throw new BadRequestException('Địa điểm không thuộc hộ.');
      const token=randomBytes(32).toString('base64url'),id=randomUUID();
      await c.query(`INSERT INTO invitations(id,tenant_id,role,site_ids,target_subject_id,token_hash,expires_at,confirmed_by) VALUES($1,$2,$3,$4,$5,$6,now()+interval '48 hours',$7)`,[id,tenant,input.role,unique,input.targetSubjectId,hash(token),r.actor.sub]);
      await audit(c,tenant,r.actor.sub!,'INVITATION_CONFIRMED',id,null,{targetSubjectId:input.targetSubjectId,role:input.role,siteIds:unique,mode:'OWNER_CONFIRMED'});
      return {id,token,expiresInHours:48};
    });
  }
  @Post('invitations/accept')async accept(@Req()r:ActorRequest,@Body()body:unknown){
    const {token}=z.object({token:z.string().min(40).max(100)}).strict().parse(body);
    return transaction(async c=>{
      const i=(await c.query('SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE',[hash(token)])).rows[0];
      if(!i||i.target_subject_id!==r.actor.sub)throw new NotFoundException('Lời mời không hợp lệ cho tài khoản này.');
      if(i.consumed_at)throw new ConflictException('Lời mời đã được sử dụng.');
      if(new Date(i.expires_at).getTime()<Date.now())throw new ConflictException('Lời mời đã hết hạn.');
      await membership(c,i.confirmed_by,i.tenant_id,true);
      const result=(await c.query(`INSERT INTO memberships(id,tenant_id,subject_id,role,status,site_ids) VALUES($1,$2,$3,$4,'ACTIVE',$5) RETURNING *`,[randomUUID(),i.tenant_id,r.actor.sub,i.role,i.site_ids])).rows[0];
      await c.query('UPDATE invitations SET consumed_at=now() WHERE id=$1',[i.id]);
      await audit(c,i.tenant_id,r.actor.sub!,'INVITATION_ACCEPTED',result.id,null,{role:i.role,siteIds:i.site_ids});return result;
    });
  }
  @Patch('tenants/:tenantId/memberships/:id')async changeStaff(@Req()r:ActorRequest,@Param('tenantId')tenant:string,@Param('id')id:string,@Body()body:unknown){
    z.uuid().parse(id);
    const input=z.object({role:memberRoles,status:z.enum(['ACTIVE','BLOCKED']),siteIds:z.array(z.uuid()).min(1).max(30),version:z.number().int().positive()}).strict().parse(body);
    return transaction(async c=>{
      await membership(c,r.actor.sub!,tenant,true);
      const previous=(await c.query('SELECT * FROM memberships WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,id])).rows[0];
      if(!previous)throw new NotFoundException('Không tìm thấy thành viên.');
      if(previous.role==='OWNER'||previous.subject_id===r.actor.sub)throw new ForbiddenException('Không thay đổi chủ hộ bằng chức năng này.');
      const unique=[...new Set(input.siteIds)];
      if((await c.query('SELECT id FROM sites WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[tenant,unique])).rowCount!==unique.length)throw new BadRequestException('Địa điểm không thuộc hộ.');
      const result=(await c.query('UPDATE memberships SET role=$1,status=$2,site_ids=$3,version=version+1 WHERE id=$4 AND version=$5 RETURNING *',[input.role,input.status,unique,id,input.version])).rows[0];
      if(!result)throw new ConflictException('Quyền đã được thay đổi. Vui lòng tải lại.');
      await audit(c,tenant,r.actor.sub!,'MEMBERSHIP_UPDATED',id,previous,result);return result;
    });
  }
  @Get('tenants/:tenantId/audit')async history(@Req()r:ActorRequest,@Param('tenantId')tenant:string){await membership(db,r.actor.sub!,tenant,true);return (await db.query('SELECT * FROM audit WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50',[tenant])).rows;}
}
await migrate('business');
await worker('business',['warehouse.ready','register.ready'],async(c,e)=>{
  if('data' in e)return;
  const s=(await c.query('SELECT * FROM sites WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[e.siteId,e.tenantId])).rows[0];
  if(!s||s.warehouse_id!==e.warehouseId||s.register_id!==e.registerId)return;
  const field=e.type==='warehouse.ready'?'warehouse_ready':'register_ready';
  await c.query(`UPDATE sites SET ${field}=true WHERE id=$1`,[e.siteId]);
  const active=(await c.query(`UPDATE sites SET status='ACTIVE',version=version+1 WHERE id=$1 AND status='PROVISIONING' AND warehouse_ready AND register_ready RETURNING id`,[e.siteId])).rows[0];
  if(active){await audit(c,e.tenantId,'system:provisioning','SITE_ACTIVATED',e.siteId,null,{status:'ACTIVE'});await outbox(c,'site.activated',{tenantId:e.tenantId,siteId:e.siteId,warehouseId:e.warehouseId,registerId:e.registerId});}
});
await start([Business]);
