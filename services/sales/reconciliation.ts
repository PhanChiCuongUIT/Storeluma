import {Body,ConflictException,Controller,Get,NotFoundException,Param,Post,Query,Req} from "@nestjs/common";
import {z} from "zod";
import {db,transaction} from "../../packages/platform/db.js";
import {auditEntry,idempotent,versionInput,pageResult} from "../../packages/platform/commands.js";
import {authorize} from "../../packages/platform/service-client.js";
import type {ActorRequest} from "../../packages/platform/http.js";

@Controller("v1/tenants/:tenant/reconciliation-cases")
export class Reconciliation {
  @Get() async list(@Req() r:ActorRequest,@Param("tenant") tenant:string,@Query() query:unknown){
    const p=z.object({siteId:z.uuid(),source:z.uuid().optional(),cursor:z.uuid().optional()}).strict().parse(query);
    await authorize(r,tenant,"reconciliation.read",p.siteId);
    const rows=await db.query(`SELECT * FROM reconciliation_cases WHERE tenant_id=$1 AND site_id=$2 AND ($3::uuid IS NULL OR $3 IN (id,order_id,return_id,payment_id,saga_id))
      AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT 51`,[tenant,p.siteId,p.source??null,p.cursor??null]);
    return pageResult(rows.rows,50);
  }
  @Get(":id/timeline") async timeline(@Req() r:ActorRequest,@Param("tenant") tenant:string,@Param("id") id:string){
    z.uuid().parse(id);
    const source=(await db.query("SELECT * FROM reconciliation_cases WHERE tenant_id=$1 AND id=$2",[tenant,id])).rows[0];
    if(!source)throw new NotFoundException();
    await authorize(r,tenant,"reconciliation.read",source.site_id);
    return (await db.query("SELECT action,actor,created_at,entity_id FROM audit WHERE tenant_id=$1 AND entity_id=ANY($2::uuid[]) ORDER BY created_at,id",[tenant,[id,source.order_id,source.return_id].filter(Boolean)])).rows;
  }
  @Post(":id/actions") async act(@Req() r:ActorRequest,@Param("tenant") tenant:string,@Param("id") id:string,@Body() body:unknown){
    z.uuid().parse(id);
    const p=z.object({version:versionInput,action:z.enum(["RETRY_STEP","REQUEST_COMPENSATION"]),reason:z.string().trim().min(3).max(500)}).strict().parse(body);
    const source=(await db.query("SELECT * FROM reconciliation_cases WHERE tenant_id=$1 AND id=$2",[tenant,id])).rows[0];
    if(!source)throw new NotFoundException();
    await authorize(r,tenant,"reconciliation.manage",source.site_id);
    return transaction(c=>idempotent(c,tenant+":reconciliation:"+id+":"+r.actor.sub,r.get("idempotency-key")??"",p,async()=>{
      // Workers lock their saga before the case trigger. Follow the same order.
      const table=source.return_id?"return_sagas":"checkout_sagas";
      const saga=(await c.query("SELECT *,lease_until>clock_timestamp() AS claimed FROM "+table+" WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[tenant,source.saga_id])).rows[0];
      const row=(await c.query("SELECT * FROM reconciliation_cases WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[tenant,id])).rows[0];
      if(row.version!==p.version||row.status==="RESOLVED"||saga.stage==="DONE"||saga.claimed)throw new ConflictException("Giao dịch đang được xử lý hoặc đã thay đổi.");
      if(p.action==="REQUEST_COMPENSATION"){
        if(source.return_id||["COMMIT","COMPLETE"].includes(saga.stage)||saga.payment?.status==="SUCCEEDED")throw new ConflictException("Không thể hủy giao dịch đã thu tiền.");
        await c.query("UPDATE checkout_sagas SET cancel_requested=true,cancel_reason=$2 WHERE id=$1",[saga.id,p.reason]);
      }
      await c.query("UPDATE "+table+" SET next_attempt_at=now() WHERE id=$1",[saga.id]);
      const result=(await c.query("UPDATE reconciliation_cases SET status='INVESTIGATING',version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[id])).rows[0];
      await auditEntry(c,tenant,r.actor.sub!,"RECONCILIATION_"+p.action,id,{stage:saga.stage,version:row.version},{reason:p.reason,version:result.version});
      return result;
    }));
  }
}
