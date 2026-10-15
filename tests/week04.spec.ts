import {test,expect,type BrowserContext,type Page,type APIResponse} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';
import {createHmac,createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
import amqp from 'amqplib';
const origin='http://localhost:4100';
const accounts=JSON.parse(readFileSync('infra/generated/accounts.json','utf8')) as {username:string,subject:string,password:string,otpSecret:string}[];
const env=Object.fromEntries(readFileSync('.env','utf8').trim().split(/\r?\n/).map(s=>s.split('=')));
const pool=(service:string)=>new Pool({host:'127.0.0.1',port:55432,user:service,password:env[`${service.toUpperCase()}_DB_PASSWORD`],database:service+'_db',max:2});
const business=pool('business'),inventory=pool('inventory'),finance=pool('finance'),gateway=pool('gateway');
function otp(secret:string){let bits=0,value=0,bytes:number[]=[];for(const ch of secret){value=(value<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch);bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const digest=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();const offset=digest.at(-1)!&15;return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');}
async function login(page:Page,index:number){
  await page.goto('/');await page.getByRole('link',{name:/Đăng nhập vào Storeluma/}).click();
  await page.waitForLoadState('load');
  if(index===0)await page.locator('.pf-v5-c-login__container').screenshot({path:'docs/week-04/evidence/screenshots/08-credentials.png'});
  await page.locator('#username').fill(accounts[index].username);await page.locator('#password').fill(accounts[index].password);await page.locator('#kc-login').click();
  await expect(page.locator('#otp')).toBeVisible();
  await page.waitForLoadState('load');
  if(index===0)await page.locator('.pf-v5-c-login__container').screenshot({path:'docs/week-04/evidence/screenshots/09-totp.png'});
  await page.locator('#otp').fill(otp(accounts[index].otpSecret));await page.locator('#kc-login').click();
  await expect(page).toHaveURL(origin+'/');await expect(page.getByRole('button',{name:'Đăng xuất'})).toBeVisible();
}
async function api(ctx:BrowserContext,path:string,method='GET',data?:unknown,key?:string,headers:Record<string,string>={}){
  const session=await ctx.request.get('/auth/session');const s=session.ok()?await session.json():{};
  return ctx.request.fetch(path,{method,data,headers:{origin,'x-csrf-token':s.csrf??'',...(key?{'idempotency-key':key}:{}),...headers}});
}
async function good(r:APIResponse){expect(r.status(),await r.text()).toBeLessThan(300);return r.json();}
async function ready(ctx:BrowserContext,tenant:string,site:string){await expect.poll(async()=>{const r=await api(ctx,`/v1/tenants/${tenant}/sites/${site}`);return r.ok()?(await r.json()).status:r.status();},{timeout:45000}).toBe('ACTIVE');}
function docker(...args:string[]){return execFileSync('docker',['compose',...args],{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});}
test.describe.serial('Week 4 foundation - live PostgreSQL / RabbitMQ / Keycloak',()=>{
  let owner:BrowserContext,cashier:BrowserContext,outsider:BrowserContext;
  let ownerPage:Page,cashierPage:Page,outsiderPage:Page;
  let tenant:string,first:string,second:string,member:any;
  const run=Date.now().toString(36);
  test.beforeAll(async({browser})=>{
    mkdirSync('docs/week-04/evidence/screenshots',{recursive:true});
    await expect.poll(async()=>{try{return (await fetch(origin+'/health')).status;}catch{return 0;}},{timeout:90000}).toBe(200);
    owner=await browser.newContext();cashier=await browser.newContext();outsider=await browser.newContext();
    ownerPage=await owner.newPage();cashierPage=await cashier.newPage();outsiderPage=await outsider.newPage();
    await ownerPage.goto('/');await expect(ownerPage.getByRole('heading',{name:'Đăng nhập',exact:true})).toBeVisible();await ownerPage.screenshot({path:'docs/week-04/evidence/screenshots/01-login.png',fullPage:true});
    await login(ownerPage,0);await login(cashierPage,1);await login(outsiderPage,2);
  });
  test('W4-01 Password + TOTP, server session, no browser tokens',async()=>{
    const data=await good(await owner.request.get('/auth/session'));expect(data.user.subjectId).toBe(accounts[0].subject);expect(data.accessToken).toBeUndefined();
    const cookies=await owner.cookies();const cookie=cookies.find(c=>c.name==='sl_session')!;expect(cookie.httpOnly).toBe(true);expect(cookie.sameSite).toBe('Lax');
    expect(await ownerPage.evaluate(()=>Object.keys(localStorage))).toEqual([]);
  });
  test('W4-02 Unauthenticated and forged identity denied',async({request})=>{
    expect((await request.get('/v1/me',{headers:{authorization:'Bearer forged','x-subject-id':accounts[0].subject}})).status()).toBe(401);
    const result=docker('exec','-T','business','node','-e',"fetch('http://localhost:4100/v1/me',{headers:{authorization:'Bearer forged'}}).then(r=>console.log(r.status))");expect(result.trim()).toBe('401');
  });
  test('W4-03 Missing CSRF and foreign Origin denied',async()=>{
    expect((await owner.request.post('/v1/tenants',{data:{}})).status()).toBe(403);
    expect((await api(owner,'/v1/tenants','POST',{},undefined,{origin:'http://attacker.invalid'})).status()).toBe(403);
  });
  test('W4-04 Concurrent create retry creates one tenant and first site',async()=>{
    const body={name:'Hộ kinh doanh An Bình',contact:`Dữ liệu kiểm thử ${run}`,site:{code:'CH01',name:'Cửa hàng Trung Tâm',address:'Quận 7, TP. Hồ Chí Minh'}};const key=randomUUID();
    const responses=await Promise.all(Array.from({length:6},()=>api(owner,'/v1/tenants','POST',body,key)));const rows=await Promise.all(responses.map(good));
    expect(new Set(rows.map(r=>r.tenantId)).size).toBe(1);tenant=rows[0].tenantId;first=rows[0].site.id;
    expect(Number((await business.query('SELECT count(*) FROM sites WHERE tenant_id=$1',[tenant])).rows[0].count)).toBe(1);
    expect((await api(owner,'/v1/tenants','POST',{...body,name:'Khác'},key)).status()).toBe(409);
  });
  test('W4-05 Warehouse and register acknowledge before ACTIVE',async()=>{
    await ready(owner,tenant,first);const row=await good(await api(owner,`/v1/tenants/${tenant}/sites/${first}`));expect(row.warehouse_ready&&row.register_ready).toBe(true);
    expect((await inventory.query('SELECT * FROM warehouses WHERE site_id=$1',[first])).rowCount).toBe(1);
    expect((await finance.query('SELECT * FROM registers WHERE site_id=$1',[first])).rowCount).toBe(1);
    expect((await api(owner,'/v1/context','POST',{tenantId:tenant,siteId:first})).status()).toBe(201);
  });
  test('W4-06 Different tenant and forged tenant/subject headers denied',async()=>{
    const theirs=await good(await api(outsider,'/v1/tenants','POST',{name:`Hộ khác ${run}`,site:{code:'CH01',name:'Cửa hàng khác'}},randomUUID()));
    expect((await api(outsider,`/v1/tenants/${tenant}/sites`,'GET',undefined,undefined,{'x-subject-id':accounts[0].subject,'x-tenant-id':tenant})).status()).toBe(404);
    expect((await api(owner,`/v1/tenants/${tenant}/sites/${theirs.site.id}`)).status()).toBe(404);
  });
  test('W4-07 Finance outage keeps new site pending, old site stays active',async()=>{
    docker('stop','finance');
    try{
      const row=await good(await api(owner,`/v1/tenants/${tenant}/sites`,'POST',{code:'CH02',name:'Cửa hàng Phú Mỹ',address:'TP. Hồ Chí Minh'},randomUUID()));second=row.id;
      await expect.poll(async()=>{return (await good(await api(owner,`/v1/tenants/${tenant}/sites/${second}`))).warehouse_ready;}).toBe(true);
      const pending=await good(await api(owner,`/v1/tenants/${tenant}/sites/${second}`));expect(pending.status).toBe('PROVISIONING');expect(pending.register_ready).toBe(false);
      expect((await api(owner,'/v1/context','POST',{tenantId:tenant,siteId:second})).status()).toBe(409);
      expect((await good(await api(owner,`/v1/tenants/${tenant}/sites/${first}`))).status).toBe('ACTIVE');
      await ownerPage.reload();await ownerPage.getByLabel('Chọn hộ kinh doanh',{exact:true}).selectOption(tenant);await expect(ownerPage.getByText('Cửa hàng Phú Mỹ',{exact:true})).toBeVisible();
      await ownerPage.screenshot({path:'docs/week-04/evidence/screenshots/02-provisioning.png',fullPage:true});
    }finally{docker('start','finance');}
    await ready(owner,tenant,second);
  });
  test('W4-08 Replayed event does not duplicate warehouse/register',async()=>{
    const event=(await business.query("SELECT payload FROM outbox WHERE type='site.provision.requested' AND payload->>'siteId'=$1",[first])).rows[0].payload;
    const connection=await amqp.connect(`amqp://storeluma:${env.RABBIT_PASSWORD}@127.0.0.1:5673`);const channel=await connection.createConfirmChannel();
    for(let i=0;i<5;i++)channel.publish('storeluma',event.type,Buffer.from(JSON.stringify(event)),{persistent:true});
    const barrier={...event,id:randomUUID()};channel.publish('storeluma',barrier.type,Buffer.from(JSON.stringify(barrier)),{persistent:true});await channel.waitForConfirms();await connection.close();
    for(const db of [inventory,finance])await expect.poll(async()=>Number((await db.query('SELECT count(*) FROM inbox WHERE id=$1',[barrier.id])).rows[0].count)).toBe(1);
    await expect.poll(async()=>Number((await inventory.query('SELECT count(*) FROM inbox WHERE id=$1',[event.id])).rows[0].count)).toBe(1);
    expect(Number((await inventory.query('SELECT count(*) FROM warehouses WHERE site_id=$1',[first])).rows[0].count)).toBe(1);
    expect(Number((await finance.query('SELECT count(*) FROM registers WHERE site_id=$1',[first])).rows[0].count)).toBe(1);
  });
  test('W4-09 Invitation requires owner confirmation and exact recipient; one use',async()=>{
    const input={targetSubjectId:accounts[1].subject,role:'CASHIER',siteIds:[first],ownerConfirmed:true};
    expect((await api(owner,`/v1/tenants/${tenant}/invitations`,'POST',{...input,ownerConfirmed:false})).status()).toBe(400);
    const expired=await good(await api(owner,`/v1/tenants/${tenant}/invitations`,'POST',input));
    await business.query("UPDATE invitations SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
    expect((await api(cashier,'/v1/invitations/accept','POST',{token:expired.token})).status()).toBe(409);
    const invite=await good(await api(owner,`/v1/tenants/${tenant}/invitations`,'POST',input));
    expect((await api(outsider,'/v1/invitations/accept','POST',{token:invite.token})).status()).toBe(404);
    member=await good(await api(cashier,'/v1/invitations/accept','POST',{token:invite.token}));
    expect((await api(cashier,'/v1/invitations/accept','POST',{token:invite.token})).status()).toBe(409);
    expect((await business.query('SELECT * FROM memberships WHERE tenant_id=$1 AND subject_id=$2',[tenant,accounts[1].subject])).rowCount).toBe(1);
  });
  test('W4-10 Cashier limited to assigned site and cannot grant rights',async()=>{
    expect((await good(await api(cashier,`/v1/tenants/${tenant}/sites`))).map((s:any)=>s.id)).toEqual([first]);
    expect((await api(cashier,`/v1/tenants/${tenant}/sites/${second}`)).status()).toBe(404);
    expect((await api(cashier,'/v1/context','POST',{tenantId:tenant,siteId:second})).status()).toBe(404);
    expect((await api(cashier,`/v1/tenants/${tenant}/memberships`)).status()).toBe(403);
    expect((await api(cashier,`/v1/tenants/${tenant}/sites`,'POST',{code:'NO',name:'Không có quyền'},randomUUID())).status()).toBe(403);
    expect((await api(cashier,`/v1/tenants/${tenant}/invitations`,'POST',{targetSubjectId:accounts[2].subject,role:'MANAGER',siteIds:[first],ownerConfirmed:true})).status()).toBe(403);
    await cashierPage.reload();await cashierPage.getByLabel('Chọn hộ kinh doanh',{exact:true}).selectOption(tenant);await expect(cashierPage.getByRole('button',{name:'Nhân sự',exact:true})).toHaveCount(0);
    await cashierPage.screenshot({path:'docs/week-04/evidence/screenshots/04-cashier.png',fullPage:true});
  });
  test('W4-11 Block takes effect in existing session; stale permission update rejected',async()=>{
    const input={role:'CASHIER',status:'BLOCKED',siteIds:[first],version:member.version};
    member=await good(await api(owner,`/v1/tenants/${tenant}/memberships/${member.id}`,'PATCH',input));
    expect((await api(cashier,`/v1/tenants/${tenant}/sites`)).status()).toBe(403);
    expect((await api(owner,`/v1/tenants/${tenant}/memberships/${member.id}`,'PATCH',input)).status()).toBe(409);
    member=await good(await api(owner,`/v1/tenants/${tenant}/memberships/${member.id}`,'PATCH',{...input,status:'ACTIVE',version:member.version}));
    expect((await api(cashier,`/v1/tenants/${tenant}/sites`)).status()).toBe(200);
  });
  test('W4-12 Owner cannot remove own final ownership',async()=>{
    const rows=await good(await api(owner,`/v1/tenants/${tenant}/memberships`));const own=rows.find((m:any)=>m.role==='OWNER');
    expect((await api(owner,`/v1/tenants/${tenant}/memberships/${own.id}`,'PATCH',{role:'CASHIER',status:'BLOCKED',siteIds:[first],version:own.version})).status()).toBe(403);
  });
  test('W4-13 Site optimistic locking and suspension gate',async()=>{
    let s=await good(await api(owner,`/v1/tenants/${tenant}/sites/${second}`));const input={name:s.name,address:s.address,status:'SUSPENDED',version:s.version};
    const changed=await good(await api(owner,`/v1/tenants/${tenant}/sites/${second}`,'PATCH',input));
    expect((await api(owner,'/v1/context','POST',{tenantId:tenant,siteId:second})).status()).toBe(409);
    expect((await api(owner,`/v1/tenants/${tenant}/sites/${second}`,'PATCH',input)).status()).toBe(409);
    await good(await api(owner,`/v1/tenants/${tenant}/sites/${second}`,'PATCH',{...input,status:'ACTIVE',version:changed.version}));
  });
  test('W4-14 Restart retains data, context and audit',async()=>{
    docker('restart','business','gateway');
    await expect.poll(async()=>{try{return (await owner.request.get('/auth/session')).status();}catch{return 0;}},{timeout:60000}).toBe(200);
    await expect.poll(async()=>{try{return (await api(owner,`/v1/tenants/${tenant}/sites`)).status();}catch{return 0;}},{timeout:60000}).toBe(200);
    const rows=await good(await api(owner,`/v1/tenants/${tenant}/audit`));expect(rows.some((r:any)=>r.action==='MEMBERSHIP_UPDATED')).toBe(true);expect(rows.some((r:any)=>r.action==='SITE_ACTIVATED')).toBe(true);
  });
  test('W4-15 Database roles cannot connect to another service database',async()=>{
    const denied=new Pool({host:'127.0.0.1',port:55432,user:'business',password:env.BUSINESS_DB_PASSWORD,database:'finance_db'});
    await expect(denied.query('SELECT 1')).rejects.toMatchObject({code:'42501'});await denied.end();
  });
  test('W4-16 Browser creates site, renders staff and audit; mobile layout',async()=>{
    await ownerPage.reload();await ownerPage.getByLabel('Chọn hộ kinh doanh',{exact:true}).selectOption(tenant);
    await expect(ownerPage.getByLabel('Chọn hộ kinh doanh',{exact:true})).toHaveValue(tenant);
    await ownerPage.getByRole('button',{name:'+ Thêm địa điểm',exact:true}).click();
    const dialog=ownerPage.getByRole('dialog');await dialog.getByLabel('Tên địa điểm',{exact:true}).fill('Cửa hàng Nam Long');await dialog.getByLabel('Mã địa điểm',{exact:true}).fill('CH03');await dialog.getByLabel('Địa chỉ',{exact:true}).fill('TP. Hồ Chí Minh');await dialog.getByRole('button',{name:'Tạo mới'}).click();
    await expect(dialog).toHaveCount(0);const card=ownerPage.locator('article').filter({hasText:'Cửa hàng Nam Long'});await expect(card.getByText('Sẵn sàng',{exact:true})).toBeVisible({timeout:45000});
    await expect(ownerPage.getByAltText('Storeluma')).toBeVisible();
    expect(await ownerPage.getByAltText('Storeluma').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
    await expect(ownerPage.locator('body')).not.toContainText(/Tuần 4|Đồ án|Bản chạy phát triển|Nền hệ thống|Đúng người\. Đúng quyền/);
    const search=ownerPage.getByLabel('Tìm địa điểm',{exact:true});
    await search.fill('cua hang nam long');await expect(ownerPage.locator('article')).toHaveCount(1);await expect(card).toBeVisible();
    await search.fill('khong-co-dia-diem');await expect(ownerPage.locator('article')).toHaveCount(0);
    await ownerPage.getByRole('button',{name:'Xóa bộ lọc'}).click();await expect(ownerPage.locator('article')).toHaveCount(3);
    await ownerPage.getByLabel('Lọc trạng thái').selectOption('SUSPENDED');await expect(ownerPage.locator('article')).toHaveCount(0);
    await ownerPage.getByLabel('Lọc trạng thái').selectOption('ALL');
    await ownerPage.getByRole('button',{name:'Xem dạng danh sách'}).click();await expect(ownerPage.locator('.site-grid')).toHaveClass(/list-view/);
    await ownerPage.getByRole('button',{name:'Xem dạng thẻ'}).click();
    const add=ownerPage.getByRole('button',{name:'+ Thêm địa điểm',exact:true});await add.click();
    const close=dialog.getByRole('button',{name:'Đóng',exact:true});await expect(close).toBeFocused();
    await ownerPage.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'Tạo mới'})).toBeFocused();
    await ownerPage.keyboard.press('Tab');await expect(close).toBeFocused();
    await ownerPage.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(add).toBeFocused();
    await ownerPage.screenshot({path:'docs/week-04/evidence/screenshots/03-sites.png',fullPage:true});
    await expect(ownerPage.getByLabel('Chọn hộ kinh doanh',{exact:true})).toHaveValue(tenant);
    await ownerPage.getByRole('button',{name:'Nhân sự',exact:true}).click();await expect(ownerPage.getByRole('button',{name:'Sửa quyền'})).toBeVisible();await ownerPage.screenshot({path:'docs/week-04/evidence/screenshots/05-staff.png',fullPage:true});
    for(const status of ['BLOCKED','ACTIVE']){
      await ownerPage.getByRole('button',{name:'Sửa quyền',exact:true}).click();
      await dialog.getByLabel('Trạng thái thành viên',{exact:true}).selectOption(status);
      await dialog.getByRole('button',{name:'Lưu quyền',exact:true}).click();await expect(dialog).toHaveCount(0);
      expect((await api(cashier,`/v1/tenants/${tenant}/sites`)).status()).toBe(status==='BLOCKED'?403:200);
    }
    await ownerPage.getByRole('button',{name:'Lịch sử thao tác',exact:true}).click();await expect(ownerPage.getByText('Tạo hộ',{exact:true})).toBeVisible();await ownerPage.screenshot({path:'docs/week-04/evidence/screenshots/06-audit.png',fullPage:true});
    await ownerPage.setViewportSize({width:390,height:844});await ownerPage.getByRole('button',{name:'Địa điểm',exact:true}).click();expect(await ownerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await ownerPage.screenshot({path:'docs/week-04/evidence/screenshots/07-mobile.png',fullPage:true});
  });
  test('W4-19 Selected context follows site status and membership scope',async()=>{
    await good(await api(cashier,'/v1/context','POST',{tenantId:tenant,siteId:first}));
    await cashierPage.reload();await cashierPage.getByLabel('Chọn hộ kinh doanh',{exact:true}).selectOption(tenant);
    await expect(cashierPage.locator('.context')).toContainText('Cửa hàng Trung Tâm');
    let site=await good(await api(owner,`/v1/tenants/${tenant}/sites/${first}`));
    try{
      site=await good(await api(owner,`/v1/tenants/${tenant}/sites/${first}`,'PATCH',{name:site.name,address:site.address,status:'SUSPENDED',version:site.version}));
      expect((await good(await cashier.request.get('/auth/session'))).context).toBeUndefined();
      await expect(cashierPage.locator('.context')).toHaveCount(0);
    }finally{
      site=await good(await api(owner,`/v1/tenants/${tenant}/sites/${first}`,'PATCH',{name:site.name,address:site.address,status:'ACTIVE',version:site.version}));
    }
    await good(await api(cashier,'/v1/context','POST',{tenantId:tenant,siteId:first}));
    member=(await good(await api(owner,`/v1/tenants/${tenant}/memberships`))).find((m:any)=>m.subject_id===accounts[1].subject);
    try{
      member=await good(await api(owner,`/v1/tenants/${tenant}/memberships/${member.id}`,'PATCH',{role:'MANAGER',status:'ACTIVE',siteIds:[second],version:member.version}));
      expect((await good(await cashier.request.get('/auth/session'))).context).toBeUndefined();
      expect((await api(cashier,`/v1/tenants/${tenant}/sites/${first}`,'PATCH',{name:site.name,address:site.address,status:'ACTIVE',version:site.version})).status()).toBe(404);
      await expect(cashierPage.locator('article').filter({hasText:'Cửa hàng Trung Tâm'})).toHaveCount(0);
      const assigned=cashierPage.locator('article').filter({hasText:'Cửa hàng Phú Mỹ'});
      await expect(assigned.getByRole('button',{name:'Chỉnh sửa',exact:true})).toBeVisible();
      let permitted=await good(await api(cashier,`/v1/tenants/${tenant}/sites/${second}`));
      permitted=await good(await api(cashier,`/v1/tenants/${tenant}/sites/${second}`,'PATCH',{name:permitted.name,address:permitted.address,status:'ACTIVE',version:permitted.version}));
      expect((await api(cashier,`/v1/tenants/${tenant}/memberships`)).status()).toBe(403);
      for(const role of ['STOCK','ACCOUNTANT','CASHIER']){
        member=await good(await api(owner,`/v1/tenants/${tenant}/memberships/${member.id}`,'PATCH',{role,status:'ACTIVE',siteIds:[second],version:member.version}));
        expect((await good(await api(cashier,`/v1/tenants/${tenant}/sites`))).map((s:any)=>s.id)).toEqual([second]);
        expect((await api(cashier,`/v1/tenants/${tenant}/sites/${second}`,'PATCH',{name:permitted.name,address:permitted.address,status:'ACTIVE',version:permitted.version})).status()).toBe(403);
      }
      await expect(assigned.getByRole('button',{name:'Chỉnh sửa',exact:true})).toHaveCount(0);
      await good(await api(cashier,'/v1/context','POST',{tenantId:tenant,siteId:second}));
      member=await good(await api(owner,`/v1/tenants/${tenant}/memberships/${member.id}`,'PATCH',{role:'MANAGER',status:'BLOCKED',siteIds:[second],version:member.version}));
      expect((await good(await cashier.request.get('/auth/session'))).context).toBeUndefined();
      const other=await good(await api(owner,`/v1/tenants/${tenant}/sites/${second}`));
      expect((await api(cashier,`/v1/tenants/${tenant}/sites/${second}`,'PATCH',{name:other.name,address:other.address,status:'ACTIVE',version:other.version})).status()).toBe(403);
    }finally{
      member=await good(await api(owner,`/v1/tenants/${tenant}/memberships/${member.id}`,'PATCH',{role:'CASHIER',status:'ACTIVE',siteIds:[first],version:member.version}));
    }
  });
  test('W4-20 Browser creates tenant, invites and accepts the assigned employee',async()=>{
    await ownerPage.setViewportSize({width:1440,height:1000});await ownerPage.reload();
    await ownerPage.getByRole('button',{name:'Tạo hộ kinh doanh',exact:true}).first().click();
    const dialog=ownerPage.getByRole('dialog');
    const tenantName=`Hộ kinh doanh Minh An ${run}`;
    await dialog.getByLabel('Tên hộ kinh doanh',{exact:true}).fill(tenantName);
    await dialog.getByLabel('Liên hệ',{exact:true}).fill('Cửa hàng Minh An');
    await dialog.getByLabel('Tên địa điểm',{exact:true}).fill('Cửa hàng Minh An');
    await dialog.getByLabel('Mã địa điểm',{exact:true}).fill('MA01');
    await dialog.getByLabel('Địa chỉ',{exact:true}).fill('TP. Hồ Chí Minh');
    await dialog.getByRole('button',{name:'Tạo mới',exact:true}).click();await expect(dialog).toHaveCount(0);
    const newCard=ownerPage.locator('article').filter({hasText:'Cửa hàng Minh An'});
    await expect(newCard.getByText('Sẵn sàng',{exact:true})).toBeVisible({timeout:45000});
    await newCard.getByRole('button',{name:'Chọn làm việc',exact:true}).click();
    await expect(ownerPage.locator('.context')).toContainText('Cửa hàng Minh An');
    const createdTenant=await ownerPage.getByLabel('Chọn hộ kinh doanh',{exact:true}).inputValue();
    await ownerPage.getByRole('button',{name:'Nhân sự',exact:true}).click();
    await ownerPage.getByRole('button',{name:'+ Mời nhân viên',exact:true}).click();
    await dialog.getByLabel('Mã tài khoản người nhận',{exact:true}).fill(accounts[1].subject);
    await dialog.getByLabel('Tôi đã xác nhận mã tài khoản thuộc đúng người nhận.',{exact:true}).check();
    await dialog.getByRole('button',{name:'Tạo lời mời',exact:true}).click();
    await expect(dialog.getByRole('alert')).toHaveText('Chọn ít nhất một địa điểm cho nhân viên.');
    await dialog.getByLabel('Cửa hàng Minh An',{exact:true}).check();
    await dialog.getByRole('button',{name:'Tạo lời mời',exact:true}).click();
    await expect(dialog.getByLabel('Mã lời mời',{exact:true})).toBeVisible();
    const token=await dialog.getByLabel('Mã lời mời',{exact:true}).inputValue();
    await dialog.getByRole('button',{name:'Đã lưu mã',exact:true}).click();
    await cashierPage.reload();await cashierPage.getByRole('button',{name:'Nhận lời mời',exact:true}).click();
    const accept=cashierPage.getByRole('dialog');await accept.getByLabel('Mã lời mời',{exact:true}).fill(token);
    await accept.getByRole('button',{name:'Xác nhận nhận lời mời',exact:true}).click();await expect(accept).toHaveCount(0);
    await cashierPage.getByLabel('Chọn hộ kinh doanh',{exact:true}).selectOption(createdTenant);
    await expect(cashierPage.locator('article')).toHaveCount(1);
    await expect(cashierPage.getByRole('heading',{name:'Cửa hàng Minh An',exact:true})).toBeVisible();
    await expect(cashierPage.getByRole('button',{name:'Nhân sự',exact:true})).toHaveCount(0);
    expect((await good(await api(cashier,`/v1/tenants/${createdTenant}/sites`)))).toHaveLength(1);
    const audits=await good(await api(owner,`/v1/tenants/${createdTenant}/audit`));
    expect(audits.map((a:any)=>a.action)).toEqual(expect.arrayContaining(['TENANT_CREATED','INVITATION_CONFIRMED','INVITATION_ACCEPTED']));
  });
  test('W4-17 Expired server session rejected',async()=>{
    const sid=(await outsider.cookies()).find(c=>c.name==='sl_session')!.value;
    await gateway.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id_hash=$1",[createHash('sha256').update(sid).digest('hex')]);expect((await outsider.request.get('/v1/me')).status()).toBe(401);
  });
  test('W4-18 Logout deletes BFF session and ends Keycloak login',async()=>{
    await ownerPage.setViewportSize({width:1440,height:1000});await ownerPage.getByRole('button',{name:'Đăng xuất'}).click();await expect(ownerPage.getByRole('link',{name:/Đăng nhập vào Storeluma/})).toBeVisible();
    expect((await owner.request.get('/v1/me')).status()).toBe(401);await ownerPage.getByRole('link',{name:/Đăng nhập vào Storeluma/}).click();await expect(ownerPage.locator('#username')).toBeVisible();
  });
  test.afterAll(async()=>{await Promise.allSettled([owner?.close(),cashier?.close(),outsider?.close(),business.end(),inventory.end(),finance.end(),gateway.end()]);});
});
