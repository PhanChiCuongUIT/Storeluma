import {Body,ConflictException,Controller,ForbiddenException,Get,NotFoundException,Param,Post,Query,Req} from "@nestjs/common";
import { z } from "zod";
import { db,transaction } from "./db.js";
import type {ActorRequest} from "./http.js";
import {authorize} from "./service-client.js";
import {versionInput} from "./commands.js";

export function platformOperator(r:ActorRequest){
  const realm=r.actor.realm_access as {roles?:string[]}|undefined;
  return Array.isArray(realm?.roles)&&realm.roles.includes("storeluma-ops");
}
export function requireOperator(r:ActorRequest){
  if(!platformOperator(r))throw new ForbiddenException("Cần quyền vận hành nền tảng.");
}

@Controller("v1")
export class Operations {
  @Get("ops/services/:service/dead-letters") async list(@Req() r:ActorRequest,@Param("service") service:string,@Query("cursor") cursor?:string){
    requireOperator(r);
    if(service!==process.env.SERVICE_NAME)throw new NotFoundException();
    if(cursor)z.uuid().parse(cursor);
    const rows=await db.query(`SELECT id,event_id,event_type,status,reason,version,created_at FROM dead_letters
      WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 101`,[cursor??null]);
    const backlog=(await db.query("SELECT count(*)::int pending,min(created_at) oldest FROM outbox WHERE delivered_at IS NULL")).rows[0];
    return {items:rows.rows.slice(0,100),nextCursor:rows.rows.length>100?rows.rows[99].id:null,backlog};
  }
  @Post("ops/services/:service/dead-letters/:id/replay") async replay(@Req() r:ActorRequest,@Param("service") service:string,@Param("id") id:string,@Body() body:unknown){
    requireOperator(r);
    if(service!==process.env.SERVICE_NAME)throw new NotFoundException();
    z.uuid().parse(id);
    const p=z.object({version:versionInput,reason:z.string().trim().min(3).max(500)}).strict().parse(body);
    return transaction(async c=>{
      const row=(await c.query("SELECT status,version,payload IS NOT NULL AS valid FROM dead_letters WHERE id=$1 FOR UPDATE",[id])).rows[0];
      if(!row)throw new NotFoundException();
      if(row.status==='PROCESSED'||row.status==='REQUESTED')return {status:row.status};
      if(row.version!==p.version||!row.valid)throw new ConflictException("Sự kiện cần sửa tại nguồn trước khi phát lại.");
      await c.query("UPDATE dead_letters SET status='REQUESTED',version=version+1 WHERE id=$1",[id]);
      await c.query("INSERT INTO replay_audit(letter_id,actor,reason) VALUES($1,$2,$3)",[id,r.actor.sub,p.reason]);
      return {status:"REQUESTED"};
    });
  }

  @Get("tenants/:tenant/audit-records") async audit(@Req() r:ActorRequest,@Param("tenant") tenant:string,@Query("source") source:string){
    z.uuid().parse(source);z.uuid().parse(tenant);
    if(process.env.SERVICE_NAME==="business"){
      if(!(await db.query("SELECT 1 FROM memberships WHERE tenant_id=$1 AND subject_id=$2 AND role='OWNER' AND status='ACTIVE'",[tenant,r.actor.sub])).rowCount)
        throw new ForbiddenException();
    }else await authorize(r,tenant,"audit.read");
    // Only document IDs, actors and transitions leave a service. Contact details and snapshots stay local.
    return (await db.query("SELECT id,entity_id,action,actor,created_at FROM audit WHERE tenant_id=$1 AND entity_id=$2 ORDER BY created_at,id LIMIT 250",[tenant,source])).rows;
  }
}
