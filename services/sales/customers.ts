import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import type { PoolClient } from "pg";
import { db, transaction } from "../../packages/platform/db.js";
import { authorize } from "../../packages/platform/service-client.js";
import { auditEntry, idempotent, pageResult, versionInput } from "../../packages/platform/commands.js";
import type { ActorRequest } from "../../packages/platform/http.js";

const phoneDigits = (s: string) => s.replace(/[\s().-]/g, "").replace(/^\+84(?=\d{9}$)/, "0");
const contact = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(32).transform(phoneDigits).pipe(z.string().regex(/^(?:\+?\d{6,15})?$/)).default(""),
  email: z.union([z.email().max(254), z.literal("")]).default(""),
  note: z.string().trim().max(500).default(""),
  marketingConsent: z.boolean().default(false),
}).strict();
const paging = z.object({cursor:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
const notFound = () => new NotFoundException("Không tìm thấy khách hàng.");
export async function selectedCustomer(c: PoolClient, tenant: string, id?: string | null) {
  if (!id) return null;
  const row = (await c.query("SELECT name FROM customers WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' FOR SHARE",[tenant,id])).rows[0];
  if (!row) throw new ConflictException("Hồ sơ khách hàng hiện không hoạt động.");
  return row;
}

@Controller("v1/tenants/:tenant/customers")
export class Customers {
  @Get() async list(@Req() r: ActorRequest,@Param("tenant") tenant: string,@Query() query: unknown) {
    const p=paging.extend({q:z.string().trim().max(120).default(""),active:z.enum(["true","false"]).default("false")}).strict().parse(query);
    await authorize(r,tenant,"customer.read");
    const rows=await db.query(`SELECT * FROM customers WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id>$2)
      AND status<>'ANONYMIZED' AND (NOT $3 OR status='ACTIVE')
      AND (strpos(lower(name),lower($4))>0 OR ($5<>'' AND strpos(phone,$5)>0))
      ORDER BY id LIMIT $6`,[tenant,p.cursor??null,p.active==="true",p.q,phoneDigits(p.q),p.limit+1]);
    return pageResult(rows.rows,p.limit);
  }

  @Post() async create(@Req() r: ActorRequest,@Param("tenant") tenant: string,@Body() body: unknown) {
    const p=contact.parse(body);
    await authorize(r,tenant,"customer.write");
    return transaction(c=>idempotent(c,tenant+":customer:create:"+r.actor.sub,r.get("idempotency-key")??"",p,async()=>{
      const row=(await c.query(`INSERT INTO customers(tenant_id,name,phone,email,note,marketing_consent)
        VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6) RETURNING id,version`,[tenant,p.name,p.phone,p.email,p.note,p.marketingConsent])).rows[0];
      await auditEntry(c,tenant,r.actor.sub!,"CUSTOMER_CREATED",row.id,null,{version:row.version});
      return row;
    }));
  }

  @Patch(":id") async update(@Req() r: ActorRequest,@Param("tenant") tenant: string,@Param("id") id: string,@Body() body: unknown) {
    z.uuid().parse(id);
    const p=contact.partial().extend({version:versionInput,status:z.enum(["ACTIVE","INACTIVE"]).optional()}).strict().parse(body);
    await authorize(r,tenant,"customer.write");
    return transaction(c=>idempotent(c,tenant+":customer:edit:"+id+":"+r.actor.sub,r.get("idempotency-key")??"",p,async()=>{
      const old=(await c.query("SELECT * FROM customers WHERE tenant_id=$1 AND id=$2 FOR UPDATE",[tenant,id])).rows[0];
      if (!old) throw notFound();
      if (old.version!==p.version || old.status==="ANONYMIZED") throw new ConflictException("Hồ sơ khách hàng đã thay đổi.");
      const supplied = (key:string) => Object.hasOwn(body as object,key);
      const row=(await c.query(`UPDATE customers SET name=$3,phone=NULLIF($4,''),email=NULLIF($5,''),note=$6,
        marketing_consent=$7,status=$8,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING id,version`,
        [tenant,id,p.name??old.name,supplied("phone")?p.phone:old.phone,supplied("email")?p.email:old.email,
         supplied("note")?p.note:old.note,supplied("marketingConsent")?p.marketingConsent:old.marketing_consent,p.status??old.status])).rows[0];
      await auditEntry(c,tenant,r.actor.sub!,"CUSTOMER_UPDATED",id,{version:old.version},{version:row.version});
      return row;
    }));
  }

  @Post(":id/anonymize") async anonymize(@Req() r: ActorRequest,@Param("tenant") tenant: string,@Param("id") id: string,@Body() body: unknown) {
    z.uuid().parse(id);
    const p=z.object({version:versionInput,reason:z.string().trim().min(3).max(250)}).strict().parse(body);
    await authorize(r,tenant,"customer.anonymize");
    return transaction(c=>idempotent(c,tenant+":customer:anonymize:"+id+":"+r.actor.sub,r.get("idempotency-key")??"",p,async()=>{
      const row=(await c.query(`UPDATE customers SET name='Khách ẩn danh',phone=NULL,email=NULL,note='',marketing_consent=false,
        status='ANONYMIZED',version=version+1 WHERE tenant_id=$1 AND id=$2 AND version=$3 AND status<>'ANONYMIZED' RETURNING id,version`,[tenant,id,p.version])).rows[0];
      if (!row) throw new ConflictException("Hồ sơ khách hàng đã thay đổi.");
      await auditEntry(c,tenant,r.actor.sub!,"CUSTOMER_ANONYMIZED",id,null,{version:row.version,reason:p.reason});
      return row;
    }));
  }

  @Get(":id/history") async history(@Req() r: ActorRequest,@Param("tenant") tenant: string,@Param("id") id: string,@Query() query: unknown) {
    z.uuid().parse(id);
    const p=paging.extend({siteId:z.uuid(),from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional()}).strict().parse(query);
    await authorize(r,tenant,"customer.read",p.siteId);
    if (!(await db.query("SELECT 1 FROM customers WHERE tenant_id=$1 AND id=$2",[tenant,id])).rowCount) throw notFound();
    const rows=await db.query(`SELECT id,code,status,payable_vnd,created_at FROM orders WHERE tenant_id=$1 AND customer_id=$2 AND site_id=$3
      AND ($4::uuid IS NULL OR id>$4) AND ($5::timestamptz IS NULL OR created_at >= $5) AND ($6::timestamptz IS NULL OR created_at < $6)
      ORDER BY id LIMIT $7`,[tenant,id,p.siteId,p.cursor??null,p.from??null,p.to??null,p.limit+1]);
    return {...pageResult(rows.rows,p.limit),dataAsOf:new Date().toISOString()};
  }
}
