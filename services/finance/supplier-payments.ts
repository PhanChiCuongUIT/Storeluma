import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import type {PoolClient} from "pg";
import { db, transaction } from "../../packages/platform/db.js";
import { authorize } from "../../packages/platform/service-client.js";
import { auditEntry, idempotent, moneyInput, versionInput } from "../../packages/platform/commands.js";
import type { ActorRequest } from "../../packages/platform/http.js";

const positive=moneyInput.refine(v=>BigInt(v)>0n);
const reason=z.string().trim().min(3).max(500);
const allocation=z.object({payableId:z.uuid(),amountVnd:positive}).strict();
const post=z.object({siteId:z.uuid(),supplierId:z.uuid(),accountId:z.uuid(),shiftId:z.uuid().optional(),amountVnd:positive,
  allocations:z.array(allocation).min(1).max(100),reference:z.string().trim().max(120).default(""),reason,cashPaid:z.literal(true)}).strict();
type Posting=z.infer<typeof post>;

async function accountFor(c:PoolClient,tenant:string,site:string,account:string,shift?:string) {
  const a=(await c.query("SELECT * FROM cash_accounts WHERE tenant_id=$1 AND site_id=$2 AND id=$3 AND status='ACTIVE' FOR SHARE",[tenant,site,account])).rows[0];
  if(!a)throw new NotFoundException("Tài khoản tiền không khả dụng.");
  if(a.kind==="DRAWER"){
    if(!shift || !(await c.query("SELECT id FROM shifts WHERE id=$1 AND tenant_id=$2 AND register_id=$3 AND site_id=$4 AND status='OPEN' FOR UPDATE",[shift,tenant,a.register_id,site])).rowCount)
      throw new ConflictException("Cần ca đang mở tại quầy đã chọn.");
  }else if(shift)throw new ConflictException("Tài khoản ngoài quầy không gắn ca.");
}
async function record(c:PoolClient,t:string,actor:string,p:Posting,reversal?:string) {
  await accountFor(c,t,p.siteId,p.accountId,p.shiftId);
  const ids=p.allocations.map(a=>a.payableId);
  if(new Set(ids).size!==ids.length||p.allocations.reduce((n,a)=>n+BigInt(a.amountVnd),0n)!==BigInt(p.amountVnd))
    throw new ConflictException("Tổng phân bổ phải bằng số thực chi.");
  const locked=await c.query("SELECT id FROM payables WHERE tenant_id=$1 AND site_id=$2 AND supplier_id=$3 AND id=ANY($4::uuid[]) ORDER BY id FOR UPDATE",[t,p.siteId,p.supplierId,ids]);
  if(locked.rowCount!==ids.length)throw new NotFoundException("Khoản phải trả không thuộc nhà cung cấp hoặc địa điểm này.");
  const row=(await c.query(`INSERT INTO supplier_payments(tenant_id,site_id,supplier_id,account_id,shift_id,amount_vnd,reference,reason,posted_by,reversal_of)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[t,p.siteId,p.supplierId,p.accountId,p.shiftId??null,p.amountVnd,p.reference,p.reason,actor,reversal??null])).rows[0];
  for(const a of p.allocations){
    const delta=reversal?"-"+a.amountVnd:a.amountVnd;
    if(!(await c.query("UPDATE payables SET paid_vnd=paid_vnd+$3 WHERE tenant_id=$1 AND id=$2 AND paid_vnd+$3 BETWEEN 0 AND total_vnd",[t,a.payableId,delta])).rowCount)
      throw new ConflictException("Số phân bổ vượt dư công nợ.");
    await c.query("INSERT INTO payable_allocations VALUES($1,$2,$3,$4)",[t,row.id,a.payableId,a.amountVnd]);
  }
  await c.query(`INSERT INTO cash_ledger(id,tenant_id,site_id,shift_id,supplier_payment_id,account_id,amount_vnd,actor_id)
    VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7)`,[t,p.siteId,p.shiftId??null,row.id,p.accountId,reversal?p.amountVnd:"-"+p.amountVnd,actor]);
  await auditEntry(c,t,actor,reversal?"SUPPLIER_PAYMENT_REVERSED":"SUPPLIER_PAYMENT_POSTED",row.id,null,{amount:p.amountVnd,reversal});
  return row;
}
@Controller("v1/tenants/:tenant")
export class SupplierPayments {
  @Get("cash-accounts") async accounts(@Req() r:ActorRequest,@Param("tenant") t:string,@Query("siteId") site:string){
    z.uuid().parse(site);await authorize(r,t,"payable.read",site);
    return (await db.query("SELECT * FROM cash_accounts WHERE tenant_id=$1 AND site_id=$2 ORDER BY kind,name,id",[t,site])).rows;
  }
  @Post("cash-accounts") async createAccount(@Req() r:ActorRequest,@Param("tenant") t:string,@Body() body:unknown){
    const p=z.object({siteId:z.uuid(),code:z.string().trim().regex(/^[A-Z0-9_-]{1,32}$/),name:z.string().trim().min(1).max(120),kind:z.enum(["CASH","BANK"])}).strict().parse(body);
    await authorize(r,t,"finance.write",p.siteId);
    return transaction(c=>idempotent(c,t+":account:"+r.actor.sub,r.get("idempotency-key")??"",p,async()=>{
      const row=(await c.query("INSERT INTO cash_accounts(tenant_id,site_id,code,name,kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,code) DO NOTHING RETURNING *",[t,p.siteId,p.code,p.name,p.kind])).rows[0];
      if(!row)throw new ConflictException("Mã tài khoản tiền đã dùng.");
      await auditEntry(c,t,r.actor.sub!,"ACCOUNT_CREATED",row.id,null,{kind:p.kind});return row;
    }));
  }
  @Get("cash-accounts/:id/entries") async entries(@Req() r:ActorRequest,@Param("tenant") t:string,@Param("id") id:string,@Query("siteId") site:string,@Query("cursor") cursor?:string){
    z.uuid().parse(id);z.uuid().parse(site);if(cursor)z.uuid().parse(cursor);await authorize(r,t,"payable.read",site);
    const rows=await db.query("SELECT * FROM cash_entries WHERE tenant_id=$1 AND site_id=$2 AND account_id=$3 AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT 51",[t,site,id,cursor??null]);
    return {items:rows.rows.slice(0,50),nextCursor:rows.rows.length>50?rows.rows[49].id:null};
  }
  @Post("cash-accounts/:id/entries") async entry(@Req() r:ActorRequest,@Param("tenant") t:string,@Param("id") id:string,@Body() body:unknown){
    z.uuid().parse(id);
    const p=z.object({siteId:z.uuid(),kind:z.enum(["IN","OUT","REVERSAL"]),amountVnd:positive.optional(),reversalOf:z.uuid().optional(),reason}).strict().parse(body);
    await authorize(r,t,"finance.write",p.siteId);
    return transaction(c=>idempotent(c,t+":account-entry:"+id+":"+r.actor.sub,r.get("idempotency-key")??"",p,async()=>{
      await accountFor(c,t,p.siteId,id);
      let amount:string;
      if(p.kind==="REVERSAL"){
        if(!p.reversalOf||p.amountVnd)throw new ConflictException("Chọn chứng từ gốc để đảo.");
        const old=(await c.query("SELECT * FROM cash_entries WHERE tenant_id=$1 AND site_id=$2 AND id=$3 AND account_id=$4 AND kind<>'REVERSAL' FOR UPDATE",[t,p.siteId,p.reversalOf,id])).rows[0];
        if(!old)throw new NotFoundException();
        if((await c.query("SELECT 1 FROM cash_entries WHERE tenant_id=$1 AND reversal_of=$2",[t,old.id])).rowCount)throw new ConflictException("Phiếu đã được đảo.");
        amount=(-BigInt(old.amount_vnd)).toString();
      }else{
        if(!p.amountVnd||p.reversalOf)throw new ConflictException("Nhập số tiền thực tế.");
        amount=p.kind==="OUT"?"-"+p.amountVnd:p.amountVnd;
      }
      const row=(await c.query(`INSERT INTO cash_entries(id,tenant_id,site_id,kind,amount_vnd,reason,created_by,reversal_of,account_id)
        VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[t,p.siteId,p.kind,amount,p.reason,r.actor.sub,p.reversalOf??null,id])).rows[0];
      await c.query("INSERT INTO cash_ledger(id,tenant_id,site_id,cash_entry_id,account_id,amount_vnd,actor_id) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6)",[t,p.siteId,row.id,id,amount,r.actor.sub]);
      await auditEntry(c,t,r.actor.sub!,"ACCOUNT_"+p.kind,row.id,null,{accountId:id,amount});return row;
    }));
  }
  @Get("supplier-payments") async list(@Req() r:ActorRequest,@Param("tenant") t:string,@Query() query:unknown){
    const p=z.object({siteId:z.uuid(),supplierId:z.uuid(),cursor:z.uuid().optional()}).strict().parse(query);
    await authorize(r,t,"payable.read",p.siteId);
    const rows=await db.query("SELECT * FROM supplier_payments WHERE tenant_id=$1 AND site_id=$2 AND supplier_id=$3 AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT 101",[t,p.siteId,p.supplierId,p.cursor??null]);
    return {items:rows.rows.slice(0,100),nextCursor:rows.rows.length>100?rows.rows[99].id:null};
  }
  @Post("supplier-payments") async pay(@Req() r:ActorRequest,@Param("tenant") t:string,@Body() body:unknown){
    const p=post.parse(body);await authorize(r,t,"finance.write",p.siteId);
    return transaction(c=>idempotent(c,t+":pay:"+r.actor.sub,r.get("idempotency-key")??"",p,()=>record(c,t,r.actor.sub!,p)));
  }
  @Post("supplier-payments/:id/reverse") async reverse(@Req() r:ActorRequest,@Param("tenant") t:string,@Param("id") id:string,@Body() body:unknown){
    z.uuid().parse(id);
    const p=z.object({version:versionInput,targetAccountId:z.uuid(),targetShiftId:z.uuid().optional(),reason}).strict().parse(body);
    const source=(await db.query("SELECT site_id FROM supplier_payments WHERE tenant_id=$1 AND id=$2",[t,id])).rows[0];
    if(!source)throw new NotFoundException();
    await authorize(r,t,"finance.write",source.site_id);
    return transaction(c=>idempotent(c,t+":reverse-pay:"+id+":"+r.actor.sub,r.get("idempotency-key")??"",p,async()=>{
      const old=(await c.query("SELECT * FROM supplier_payments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[t,id])).rows[0];
      if(old.reversal_of||old.status!=="POSTED"||old.version!==p.version)throw new ConflictException("Chứng từ không còn hiệu lực để đảo.");
      const allocations=(await c.query('SELECT payable_id AS "payableId",amount_vnd AS "amountVnd" FROM payable_allocations WHERE tenant_id=$1 AND payment_id=$2',[t,id])).rows;
      const reversed=await record(c,t,r.actor.sub!,{siteId:old.site_id,supplierId:old.supplier_id,accountId:p.targetAccountId,shiftId:p.targetShiftId,amountVnd:old.amount_vnd,reference:old.reference,reason:p.reason,cashPaid:true,allocations},id);
      await c.query("UPDATE supplier_payments SET version=version+1,status='REVERSED' WHERE tenant_id=$1 AND id=$2",[t,id]);return reversed;
    }));
  }
}
