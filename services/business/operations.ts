import {Body,ConflictException,Controller,ForbiddenException,Get,NotFoundException,Param,Post,Query,Req} from "@nestjs/common";
import {z} from "zod";
import type {ActorRequest} from "../../packages/platform/http.js";
import {platformOperator,requireOperator} from "../../packages/platform/operations.js";
import {auditEntry,idempotent,versionInput} from "../../packages/platform/commands.js";
import {db,transaction} from "../../packages/platform/db.js";
const reason=z.string().trim().min(3).max(500);
async function owner(t:string,sub:string){
  if(!(await db.query("SELECT 1 FROM memberships WHERE tenant_id=$1 AND subject_id=$2 AND role='OWNER' AND status='ACTIVE'",[t,sub])).rowCount)throw new ForbiddenException();
}
export async function supportAccess(r:ActorRequest,t:string,site:string,action:string){
  if(!platformOperator(r))return null;
  return transaction(async c=>{
    const g=(await c.query(`SELECT id FROM support_grants WHERE tenant_id=$1 AND operator_subject=$2 AND $3=ANY(site_ids)
      AND $4=ANY(actions) AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY expires_at DESC LIMIT 1 FOR SHARE`,[t,r.actor.sub,site,action])).rows[0];
    if(!g)return null;
    await auditEntry(c,t,r.actor.sub!,"SUPPORT_ACCESS",g.id,null,{site,action});
    return {role:"SUPPORT",siteIds:[site],costRead:false,permissionVersion:1};
  });
}
@Controller("v1/ops")
export class TenantOperations {
  @Get("tenants/:id") async status(@Req() r:ActorRequest,@Param("id") id:string){
    requireOperator(r);z.uuid().parse(id);
    const row=(await db.query("SELECT id,operational_status,version FROM tenants WHERE id=$1",[id])).rows[0];
    if(!row)throw new NotFoundException();return row;
  }
  @Post("tenants/:id/status") async change(@Req() r:ActorRequest,@Param("id") id:string,@Body() body:unknown){
    requireOperator(r);z.uuid().parse(id);
    const p=z.object({status:z.enum(["ACTIVE","SUSPENDED"]),version:versionInput,reason}).strict().parse(body);
    return transaction(c=>idempotent(c,id+":tenant-status:"+r.actor.sub,r.get("idempotency-key")??"",p,async()=>{
      const row=(await c.query("UPDATE tenants SET operational_status=$2,version=version+1 WHERE id=$1 AND version=$3 AND operational_status<>$2 RETURNING operational_status,version",[id,p.status,p.version])).rows[0];
      if(!row)throw new ConflictException("Trạng thái hộ đã thay đổi.");
      await auditEntry(c,id,r.actor.sub!,"TENANT_"+p.status,id,{version:p.version},{status:p.status,reason:p.reason});return row;
    }));
  }
  @Get("support-grants") async grants(@Req() r:ActorRequest,@Query("tenantId") tenant?:string){
    if(tenant){z.uuid().parse(tenant);await owner(tenant,r.actor.sub!);}
    else requireOperator(r);
    return (await db.query(`SELECT id,tenant_id,operator_subject,site_ids,actions,expires_at FROM support_grants
      WHERE revoked_at IS NULL AND expires_at>now() AND (($1::uuid IS NOT NULL AND tenant_id=$1) OR ($1 IS NULL AND operator_subject=$2)) ORDER BY expires_at`,[tenant??null,r.actor.sub])).rows;
  }
  @Post("support-grants") async grant(@Req() r:ActorRequest,@Body() body:unknown){
    const p=z.object({targetTenantId:z.uuid(),operatorSubject:z.uuid(),siteIds:z.array(z.uuid()).min(1).max(100),reason,
      actions:z.array(z.enum(["reconciliation.read","reconciliation.manage"])).min(1).max(2),expiresAt:z.iso.datetime({offset:true})}).strict().parse(body);
    await owner(p.targetTenantId,r.actor.sub!);
    return transaction(c=>idempotent(c,p.targetTenantId+":grant:"+r.actor.sub,r.get("idempotency-key")??"",p,async()=>{
      if(Date.parse(p.expiresAt)<=Date.now()||Date.parse(p.expiresAt)>Date.now()+86400000)throw new ConflictException("Quyền hỗ trợ có thời hạn tối đa 24 giờ.");
      if((await c.query("SELECT id FROM sites WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[p.targetTenantId,p.siteIds])).rowCount!==p.siteIds.length)throw new NotFoundException();
      const row=(await c.query("INSERT INTO support_grants(tenant_id,operator_subject,site_ids,actions,reason,granted_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[p.targetTenantId,p.operatorSubject,p.siteIds,p.actions,p.reason,r.actor.sub,p.expiresAt])).rows[0];
      await auditEntry(c,p.targetTenantId,r.actor.sub!,"SUPPORT_GRANTED",row.id,null,{actions:p.actions,expiresAt:p.expiresAt});return row;
    }));
  }
  @Post("support-grants/:id/revoke") async revoke(@Req() r:ActorRequest,@Param("id") id:string,@Body() body:unknown){
    const p=z.object({targetTenantId:z.uuid(),reason}).strict().parse(body);z.uuid().parse(id);await owner(p.targetTenantId,r.actor.sub!);
    return transaction(async c=>{
      const row=(await c.query("UPDATE support_grants SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL RETURNING id",[id,p.targetTenantId])).rows[0];
      if(!row)throw new NotFoundException();
      await auditEntry(c,p.targetTenantId,r.actor.sub!,"SUPPORT_REVOKED",id,null,{reason:p.reason});return row;
    });
  }
}
