import {test,expect,type BrowserContext,type APIResponse,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fixtureFile} from './helpers/fixtures';
import {fillFreshTotp} from './helpers/totp';

const accounts=JSON.parse(readFileSync('infra/generated/accounts.json','utf8'));
const origin='http://localhost:4100';
const period='from=2026-01-01&to=2026-12-31';
type Role='OWNER'|'MANAGER'|'CASHIER'|'STOCK'|'ACCOUNTANT';
const all:Role[]=['OWNER','MANAGER','CASHIER','STOCK','ACCOUNTANT'];
async function good(response:APIResponse){
  expect(response.status(),await response.text()).toBeLessThan(300);
  return response.json();
}
async function login(page:Page,index:number){
  await page.goto('/auth/login');
  await page.locator('#username').fill(accounts[index].username);
  await page.locator('#password').fill(accounts[index].password);
  await page.locator('#kc-login').click();
  await fillFreshTotp(page,accounts[index].otpSecret);
  await page.locator('#kc-login').click();
  await expect(page).toHaveURL(origin+'/');
}
async function api(ctx:BrowserContext,path:string,method='GET',data?:unknown,key?:string,headers:Record<string,string>={}){
  const session=await good(await ctx.request.get('/auth/session'));
  return ctx.request.fetch(path,{method,data,headers:{origin,'x-csrf-token':session.csrf,
    ...(key?{'idempotency-key':key}:{}),...headers}});
}

// This suite owns its tenant/site fixtures and changes roles only through Business APIs.
// It can run independently of the earlier weekly suites and on a separate Compose project.
test.describe('Week 10 access control - live services',()=>{
  let owner:BrowserContext,staff:BrowserContext,outsider:BrowserContext;
  let tenant:string,foreignTenant:string,site:any,otherSite:any,foreignSite:any,member:any;
  let product:any,foreignProduct:any,supplier:any,receipt:any,otherReceipt:any,order:any;
  const stamp=Date.now().toString(36).toUpperCase();
  const path=(resource:string,t=tenant)=>`/v1/tenants/${t}/${resource}`;
  const get=(resource:string,ctx=owner,t=tenant)=>api(ctx,path(resource,t));
  const cmd=(resource:string,body:unknown,ctx=owner,key=randomUUID(),method='POST',t=tenant)=>api(ctx,path(resource,t),method,body,key);
  async function ready(ctx:BrowserContext,t:string,id:string){
    let row:any;
    await expect.poll(async()=>{row=await good(await api(ctx,path('sites/'+id,t)));return row.status;},{timeout:45000}).toBe('ACTIVE');
    return row;
  }
  async function role(value:Exclude<Role,'OWNER'>,status='ACTIVE',siteIds=[site.id]){
    const members=await good(await get('memberships'));
    member=members.find((m:any)=>m.subject_id===accounts[1].subject);
    member=await good(await cmd('memberships/'+member.id,{role:value,status,siteIds,version:member.version},owner,randomUUID(),'PATCH'));
  }
  const draft=(s=site)=>({siteId:s.id,warehouseId:s.warehouse_id,sourceType:'PURCHASE',supplierId:supplier.id,
    note:'Kiểm tra phạm vi truy cập',lines:[{skuId:product.skus[0].id,unitId:product.skus[0].units[0].id,qty:'3',unitCostVnd:'17000'}]});
  const readRoutes=(s:string):[string,Role[]][]=>[
    ['products',all],['suppliers',['OWNER','MANAGER','STOCK','ACCOUNTANT']],
    [`stock-balances?siteId=${s}`,all],
    [`receipts?siteId=${s}`,['OWNER','MANAGER','STOCK','ACCOUNTANT']],
    [`stock-counts?siteId=${s}`,['OWNER','MANAGER','STOCK','ACCOUNTANT']],
    [`stock-adjustments?siteId=${s}`,['OWNER','MANAGER','STOCK','ACCOUNTANT']],
    [`orders?siteId=${s}`,['OWNER','MANAGER','CASHIER','ACCOUNTANT']],
    [`shifts?siteId=${s}`,['OWNER','MANAGER','CASHIER','ACCOUNTANT']],
    [`payables?siteId=${s}`,['OWNER','ACCOUNTANT']],
    [`reports/summary?${period}&siteId=${s}`,['OWNER','MANAGER','ACCOUNTANT']],
    [`reports/stock?${period}&siteId=${s}`,['OWNER','MANAGER','ACCOUNTANT']],
    [`work-items?siteId=${s}`,all],['memberships',['OWNER']],['audit',['OWNER']],
    [`notification-rules?siteId=${s}`,['OWNER','MANAGER']],
  ];
  test.beforeAll(async({browser})=>{
    test.setTimeout(180000);
    owner=await browser.newContext();staff=await browser.newContext();outsider=await browser.newContext();
    await Promise.all([login(await owner.newPage(),0),login(await staff.newPage(),1),login(await outsider.newPage(),2)]);
    const file=fixtureFile('week10-fixture.json');
    let f:any;
    if(existsSync(file)) f=JSON.parse(readFileSync(file,'utf8'));
    else{
      const a=await good(await api(owner,'/v1/tenants','POST',{name:'Hộ kiểm tra quyền A',site:{code:'A1',name:'Địa điểm A1'}},randomUUID()));
      tenant=a.tenantId;
      const second=await good(await cmd('sites',{code:'A2',name:'Địa điểm A2'}));
      const b=await good(await api(outsider,'/v1/tenants','POST',{name:'Hộ kiểm tra quyền B',site:{code:'B1',name:'Địa điểm B1'}},randomUUID()));
      const invitation=await good(await cmd('invitations',{targetSubjectId:accounts[1].subject,role:'MANAGER',siteIds:[a.site.id],ownerConfirmed:true}));
      await good(await api(staff,'/v1/invitations/accept','POST',{token:invitation.token}));
      f={tenant:a.tenantId,site:a.site.id,otherSite:second.id,foreignTenant:b.tenantId,foreignSite:b.site.id};
      writeFileSync(file,JSON.stringify(f));
    }
    tenant=f.tenant;foreignTenant=f.foreignTenant;
    [site,otherSite,foreignSite]=await Promise.all([ready(owner,tenant,f.site),ready(owner,tenant,f.otherSite),ready(outsider,foreignTenant,f.foreignSite)]);
    await role('MANAGER');
    const makeProduct=(name:string)=>({name,categoryId:null,sku:{code:'W10-'+stamp,name,baseUnit:'Gói',priceVnd:'25000'}});
    product=await good(await cmd('products',makeProduct('Hàng của hộ A')));
    foreignProduct=await good(await cmd('products',makeProduct('Hàng riêng của hộ B'),outsider,randomUUID(),'POST',foreignTenant));
    supplier=await good(await cmd('suppliers',{code:'N10-'+stamp,name:'Nhà cung cấp của hộ A'}));
    const posted=await good(await cmd('receipts',draft()));
    await good(await cmd(`receipts/${posted.id}/post`,{version:posted.version}));
    [receipt,otherReceipt]=await Promise.all([good(await cmd('receipts',draft())),good(await cmd('receipts',draft(otherSite)))]);
    const q=await good(await cmd('sales/quotes',{siteId:site.id,lines:[{skuId:product.skus[0].id,unitId:product.skus[0].units[0].id,quantity:'1'}],discount:{type:'AMOUNT',value:'0'}}));
    order=await good(await cmd('orders',{quoteId:q.id,note:'Đơn nháp kiểm tra quyền'}));
    await expect.poll(async()=>(await good(await get(`payables?siteId=${site.id}&receiptId=${posted.id}`))).items.length).toBe(1);
  });
  test.afterAll(async()=>{await Promise.all([owner?.close(),staff?.close(),outsider?.close()]);});

  for(const [index,currentRole] of all.entries()){
    test(`W10-0${index+1} ${currentRole} reads only permitted resources and cost fields`,async()=>{
      if(currentRole!=='OWNER')await role(currentRole);
      const ctx=currentRole==='OWNER'?owner:staff;
      for(const [resource,allowed] of readRoutes(site.id)){
        const response=await get(resource,ctx);
        expect(response.status(),`${currentRole}: ${resource}`).toBe(allowed.includes(currentRole)?200:403);
      }
      const stock=await good(await get(`stock-balances?siteId=${site.id}`,ctx));
      const row=stock.items.find((s:any)=>s.sku_id===product.skus[0].id);
      expect(row).toBeTruthy();expect(row.on_hand).toBe('3.000');
      if(['OWNER','ACCOUNTANT'].includes(currentRole))expect(row.inventory_value).toBe('51000');
      else for(const key of ['inventory_value','avg_cost','unit_cost_vnd','cost_vnd'])expect(row).not.toHaveProperty(key);
      if(['OWNER','MANAGER','ACCOUNTANT'].includes(currentRole)){
        const report=await good(await get(`reports/summary?${period}&siteId=${site.id}`,ctx));
        expect(report.costVisible).toBe(currentRole!=='MANAGER');
        if(currentRole==='MANAGER')expect(report.totals).not.toHaveProperty('cost_vnd');
      }
    });
  }
  test('W10-06 Tenant IDs, object IDs and forged identity headers cannot cross households',async()=>{
    await role('MANAGER');
    for(const [resource] of readRoutes(site.id))expect((await get(resource,outsider)).status(),resource).toBe(404);
    expect((await get('products/'+foreignProduct.id,owner)).status()).toBe(404);
    expect((await get('products/'+product.id,outsider,foreignTenant)).status()).toBe(404);
    for(const resource of ['receipts/'+receipt.id,'orders/'+order.id])expect((await get(resource,outsider,foreignTenant)).status()).toBe(404);
    expect((await get('products',owner,foreignTenant)).status()).toBe(404);
    await role('CASHIER');
    const forged={'x-role':'OWNER','x-subject-id':accounts[0].subject,'x-tenant-id':tenant,'x-service-authorization':'forged','x-workflow-authorization':'forged'};
    expect((await api(staff,path(`payables?siteId=${site.id}`),'GET',undefined,undefined,forged)).status()).toBe(403);
    expect((await api(outsider,path('products'),'GET',undefined,undefined,forged)).status()).toBe(404);
    const denied=await cmd('products',{name:'Forbidden',categoryId:null,sku:{code:'DENY-'+stamp,name:'Forbidden',baseUnit:'Gói',priceVnd:'1'}},outsider);
    expect(denied.status()).toBe(404);
    expect((await good(await get('products?q=Forbidden'))).items).toHaveLength(0);
  });
  test('W10-07 Assigned site applies to lists, direct documents and mutations',async()=>{
    await role('MANAGER');
    for(const [resource,allowed] of readRoutes(otherSite.id).filter(([r])=>r.includes('siteId='))){
      expect((await get(resource,staff)).status(),resource).toBe(allowed.includes('MANAGER')?404:403);
    }
    expect((await get('receipts/'+otherReceipt.id,staff)).status()).toBe(404);
    expect((await cmd('receipts/'+otherReceipt.id+'/post',{version:otherReceipt.version},staff)).status()).toBe(404);
    expect((await good(await get('receipts/'+otherReceipt.id))).status).toBe('DRAFT');
    const invalid={role:'MANAGER',status:'ACTIVE',siteIds:[foreignSite.id],version:member.version};
    expect((await cmd('memberships/'+member.id,invalid,owner,randomUUID(),'PATCH')).status()).toBe(400);
  });
  test('W10-08 Role changes revoke write permissions without a new login',async()=>{
    await role('MANAGER');
    const key=randomUUID(),body={name:'Nhóm kiểm tra '+stamp,code:'G10-'+stamp};
    const category=await good(await cmd('categories',body,staff,key));
    const id=(await staff.cookies()).find(c=>c.name==='sl_session')?.value;
    await role('ACCOUNTANT');
    expect((await cmd('categories',body,staff,key)).status()).toBe(403);
    expect((await cmd(`receipts/${receipt.id}/post`,{version:receipt.version},staff)).status()).toBe(403);
    expect((await good(await get(`receipts/${receipt.id}`))).status).toBe('DRAFT');
    expect((await staff.cookies()).some(c=>c.name==='sl_session'&&c.value===id)).toBe(true);
    expect((await good(await get('categories'))).items.filter((c:any)=>c.id===category.id)).toHaveLength(1);
    await role('MANAGER');
    expect((await good(await cmd('categories',body,staff,key))).id).toBe(category.id);
  });
  test('W10-09 Blocking a member denies all business services in the existing session',async()=>{
    await role('MANAGER','BLOCKED');
    for(const [resource] of readRoutes(site.id))expect((await get(resource,staff)).status(),resource).toBe(403);
    expect((await cmd('suppliers',{code:'BLOCK-'+stamp,name:'Không được ghi'},staff)).status()).toBe(403);
    expect((await good(await get('suppliers?q=Không được ghi'))).items).toHaveLength(0);
    await role('MANAGER');
    expect((await get('products',staff)).status()).toBe(200);
  });
  test('W10-10 Moving site scope invalidates old access while tenant-wide catalog remains readable',async()=>{
    await role('MANAGER','ACTIVE',[otherSite.id]);
    for(const resource of [`stock-balances?siteId=${site.id}`,`orders?siteId=${site.id}`,`shifts?siteId=${site.id}`,`reports/summary?${period}&siteId=${site.id}`,`work-items?siteId=${site.id}`]){
      expect((await get(resource,staff)).status(),resource).toBe(404);
    }
    expect((await get('receipts/'+receipt.id,staff)).status()).toBe(404);
    expect((await get('receipts/'+otherReceipt.id,staff)).status()).toBe(200);
    expect((await get('products/'+product.id,staff)).status()).toBe(200);
    await role('MANAGER');
  });
  test('W10-11 Browser sessions cannot call internal service, workflow or snapshot endpoints',async()=>{
    for(const endpoint of ['/v1/internal/authorize','/v1/internal/catalog/snapshots','/v1/internal/workflows/reservation/prepare','/v1/internal/projections/snapshot']){
      expect((await api(owner,endpoint,'POST',{tenantId:tenant},randomUUID(),{'x-service-authorization':'forged','x-workflow-authorization':'forged','x-projection-authorization':'forged'})).status(),endpoint).toBe(404);
    }
  });
});
