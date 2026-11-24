import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {readFileSync,mkdirSync} from "node:fs";
import {parseEnv} from "node:util";
import {Pool} from "pg";
import {accounts,api,good,login} from "./helpers/business-api";

test("W13 operations require an operator, a scoped grant for documents and an auditable replay",async({browser})=>{
  test.setTimeout(180000);
  const config=parseEnv(readFileSync(".env","utf8"));
  const base="http://localhost:8180";
  const token=await fetch(base+"/realms/master/protocol/openid-connect/token",{method:"POST",body:new URLSearchParams({grant_type:"password",client_id:"admin-cli",username:"admin",password:config.KEYCLOAK_ADMIN_PASSWORD!})});
  expect(token.ok).toBe(true);
  const admin={authorization:"Bearer "+(await token.json()).access_token,"content-type":"application/json"};
  const role=await fetch(base+"/admin/realms/storeluma/roles/storeluma-ops",{headers:admin});
  expect(role.ok).toBe(true);
  const mapping=JSON.stringify([await role.json()]);
  const endpoint=base+"/admin/realms/storeluma/users/"+accounts[2].subject+"/role-mappings/realm";
  const owner=await browser.newContext(),operator=await browser.newContext();
  const pool=new Pool({host:"127.0.0.1",port:Number(config.PG_HOST_PORT??55432),database:"finance_db",user:"finance",password:config.FINANCE_DB_PASSWORD});
  try{
    expect((await fetch(endpoint,{method:"POST",headers:admin,body:mapping})).ok).toBe(true);
    const opPage=await operator.newPage();await Promise.all([login(await owner.newPage(),0),login(opPage,2)]);
    const request=(ctx:typeof owner,path:string,data?:unknown)=>api(ctx,path,data===undefined?"GET":"POST",data,randomUUID());
    expect((await request(owner,"/v1/ops/services/finance/dead-letters")).status()).toBe(403);
    const household=await good(await request(owner,"/v1/tenants",{name:"Đối chiếu vận hành",site:{code:"OP01",name:"Quầy kiểm tra"}}));
    const tenant=household.tenantId,site=household.site.id,path="/v1/tenants/"+tenant;
    await expect.poll(async()=>(await good(await request(owner,path+"/sites/"+site))).status).toBe("ACTIVE");
    const audit=await good(await request(owner,path+"/audit-trail?source="+tenant));
    expect(audit.some((x:any)=>x.service==="business"&&x.action==="TENANT_CREATED")).toBe(true);
    const cases=path+"/reconciliation-cases?siteId="+site;
    expect((await request(operator,cases)).ok()).toBe(false);
    const grant=await good(await request(owner,"/v1/ops/support-grants",{targetTenantId:tenant,siteIds:[site],operatorSubject:accounts[2].subject,actions:["reconciliation.read"],reason:"Kiểm tra hỗ trợ",expiresAt:new Date(Date.now()+1800000).toISOString()}));
    expect((await good(await request(operator,cases))).items).toEqual([]);
    await good(await request(owner,"/v1/ops/support-grants/"+grant.id+"/revoke",{targetTenantId:tenant,reason:"Đã kiểm tra quyền"}));
    expect((await request(operator,cases)).ok()).toBe(false);
    const status="/v1/ops/tenants/"+tenant;
    const initial=await good(await request(operator,status));
    const suspended=await good(await request(operator,status+"/status",{version:initial.version,status:"SUSPENDED",reason:"Bảo trì có lịch"}));
    expect((await request(owner,path+"/shifts",{siteId:site,openingCash:"0"})).status()).toBe(409);
    await good(await request(operator,status+"/status",{version:suspended.version,status:"ACTIVE",reason:"Kết thúc bảo trì"}));
    await good(await request(owner,path+"/shifts",{siteId:site,openingCash:"0"}));
    // A retained event from this real site is already in Finance's Inbox.
    // Replaying the recorded payload three times must preserve its original ID and register.
    const bd=new Pool({host:"127.0.0.1",port:Number(config.PG_HOST_PORT??55432),database:"business_db",user:"business",password:config.BUSINESS_DB_PASSWORD});
    let event:any;
    try{event=(await bd.query("SELECT payload FROM outbox WHERE type='site.provision.requested' AND payload->>'siteId'=$1",[site])).rows[0].payload;}finally{await bd.end();}
    const letter=(await pool.query("INSERT INTO dead_letters(fingerprint,event_id,event_type,tenant_id,reason,payload) VALUES($1,$2,$3,$4,'retry-exhausted',$5) RETURNING id,version",[event.id,event.id,event.type,tenant,event])).rows[0];
    const retry="/v1/ops/services/finance/dead-letters/"+letter.id+"/replay";
    for(let i=0;i<3;i++)await good(await request(operator,retry,{version:letter.version,reason:"Đã kiểm tra sự kiện gốc"}));
    await expect.poll(async()=>(await pool.query("SELECT status FROM dead_letters WHERE id=$1",[letter.id])).rows[0].status).toBe("PROCESSED");
    expect((await pool.query("SELECT 1 FROM registers WHERE tenant_id=$1 AND site_id=$2",[tenant,site])).rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM replay_audit WHERE letter_id=$1",[letter.id])).rowCount).toBe(1);
    await opPage.getByRole("button",{name:"Hỗ trợ và vận hành"}).click();
    await expect(opPage.getByRole("heading",{name:"Vận hành nền tảng"})).toBeVisible();
    mkdirSync("tmp/week13",{recursive:true});await opPage.locator(".customer-panel").first().screenshot({path:"tmp/week13/operations.png"});
  }finally{
    await Promise.all([owner.close(),operator.close(),pool.end()]);
    await fetch(endpoint,{method:"DELETE",headers:admin,body:mapping});
  }
});
