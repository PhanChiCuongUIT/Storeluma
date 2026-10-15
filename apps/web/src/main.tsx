import React,{useState,useEffect,useRef,type FormEvent} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import './product.css';
type Membership={id:string,tenant_id:string,tenant_name:string,subject_id:string,role:string,status:string,site_ids:string[],version:number};
type Site={id:string,tenant_id:string,name:string,code:string,address:string,status:string,warehouse_ready:boolean,register_ready:boolean,version:number};
type User={subjectId:string,username:string,memberships:Membership[]};
type Session={csrf:string,user:{subjectId:string,username:string},context?:{siteName:string,siteId:string,tenantId:string},expiresAt:number};
const roleLabel:Record<string,string>={OWNER:'Chủ hộ',MANAGER:'Quản lý',CASHIER:'Thu ngân',STOCK:'Nhân viên kho',ACCOUNTANT:'Tài chính'};
const statusLabel:Record<string,string>={ACTIVE:'Sẵn sàng',PROVISIONING:'Đang khởi tạo',SUSPENDED:'Tạm ngừng'};
function App(){
  const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[me,setMe]=useState<User|null>(null);
  const [tenant,setTenant]=useState(''),[sites,setSites]=useState<Site[]>([]),[staff,setStaff]=useState<Membership[]>([]),[audit,setAudit]=useState<any[]>([]);
  const [tab,setTab]=useState('sites'),[dialog,setDialog]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [editing,setEditing]=useState<Site|null>(null),[member,setMember]=useState<Membership|null>(null),[inviteToken,setInviteToken]=useState('');
  const requestKey=useRef({payload:'',key:''});
  const current=me?.memberships.find(m=>m.tenant_id===tenant&&m.status==='ACTIVE');
  const owner=current?.role==='OWNER';
  async function api(path:string,method='GET',data?:unknown,key?:string){
    const response=await fetch(path,{method,headers:{'content-type':'application/json',...(session?{'x-csrf-token':session.csrf}:{}),...(key?{'idempotency-key':key}:{})},body:data===undefined?undefined:JSON.stringify(data)}).catch(()=>{throw new Error('Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.');});
    const body=await response.json();
    if(!response.ok){if(response.status===401){setSession(null);setMe(null);}throw new Error(body.message??'Không thể xử lý.');}return body;
  }
  async function refresh(){const user=await api('/v1/me') as User;setMe(user);return user;}
  useEffect(()=>{fetch('/auth/session').then(async r=>{if(r.ok)setSession(await r.json());}).catch(()=>setError('Không kết nối được với máy chủ.')).finally(()=>setLoading(false));},[]);
  useEffect(()=>{if(session)void refresh().catch(e=>setError(e.message));},[session?.csrf]);
  useEffect(()=>{if(!me)return;const active=me.memberships.filter(m=>m.status==='ACTIVE');if(!active.some(m=>m.tenant_id===tenant))setTenant(active[0]?.tenant_id??'');},[me]);
  useEffect(()=>{
    setSites([]);setStaff([]);setAudit([]);if(!tenant||!session)return;
    let alive=true;const load=async()=>{try{const rows=await api(`/v1/tenants/${tenant}/sites`);if(alive)setSites(rows);}catch(e){if(alive){setError((e as Error).message);void refresh().catch(()=>{});}}};
    void load();const timer=setInterval(load,2500);return()=>{alive=false;clearInterval(timer);};
  },[tenant,session?.csrf]);
  useEffect(()=>{if(!tenant||!owner){setTab('sites');return;}const path=tab==='staff'?'memberships':tab==='audit'?'audit':null;if(path)void api(`/v1/tenants/${tenant}/${path}`).then(rows=>path==='audit'?setAudit(rows):setStaff(rows)).catch(e=>setError(e.message));},[tenant,tab,owner,notice]);
  async function action(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function open(name:string){setDialog(name);setError('');setInviteToken('');requestKey.current={payload:'',key:''};}
  function idempotency(payload:unknown){const signature=JSON.stringify(payload);if(requestKey.current.payload!==signature)requestKey.current={payload:signature,key:crypto.randomUUID()};return requestKey.current.key;}
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);const value=(k:string)=>String(form.get(k)??'').trim();
    await action(async()=>{
      if(dialog==='tenant'){
        const data={name:value('name'),contact:value('contact'),site:{name:value('siteName'),code:value('code').toUpperCase(),address:value('address')}};
        const result=await api('/v1/tenants','POST',data,idempotency(data));await refresh();setTenant(result.tenantId);setNotice('Đã tạo hộ kinh doanh.');
      }else if(dialog==='site'){
        const data={name:value('name'),code:value('code').toUpperCase(),address:value('address')};await api(`/v1/tenants/${tenant}/sites`,'POST',data,idempotency(data));setSites(await api(`/v1/tenants/${tenant}/sites`));setNotice('Đã thêm địa điểm.');
      }else if(dialog==='edit'&&editing){
        await api(`/v1/tenants/${tenant}/sites/${editing.id}`,'PATCH',{name:value('name'),address:value('address'),status:value('status'),version:editing.version});setSites(await api(`/v1/tenants/${tenant}/sites`));setNotice('Đã cập nhật địa điểm.');
      }else if(dialog==='invite'){
        const result=await api(`/v1/tenants/${tenant}/invitations`,'POST',{targetSubjectId:value('subject'),role:value('role'),siteIds:form.getAll('sites'),ownerConfirmed:form.has('confirmed')});setInviteToken(result.token);setNotice('Lời mời có hiệu lực 48 giờ, chỉ dùng một lần.');return;
      }else if(dialog==='accept'){
        await api('/v1/invitations/accept','POST',{token:value('token')});await refresh();setNotice('Đã tham gia hộ kinh doanh.');
      }else if(dialog==='member'&&member){
        await api(`/v1/tenants/${tenant}/memberships/${member.id}`,'PATCH',{role:value('role'),status:value('status'),siteIds:form.getAll('sites'),version:member.version});setStaff(await api(`/v1/tenants/${tenant}/memberships`));setNotice('Đã cập nhật quyền truy cập.');
      }
      setDialog('');requestKey.current={payload:'',key:''};
    });
  }
  if(loading)return <div className="loading">Đang mở Storeluma…</div>;
  if(!session)return <main className="sign-in-page">
    <section className="sign-in-card" aria-labelledby="sign-in-title">
      <Brand/>
      <h1 id="sign-in-title">Đăng nhập</h1>
      <p>Quản lý hộ kinh doanh và địa điểm của bạn.</p>
      <a className="button primary" href="/auth/login">Đăng nhập vào Storeluma</a>
      {error&&<p role="alert" className="alert error">{error}</p>}
      <p className="sign-in-help">Sử dụng tài khoản và mã xác thực của bạn để tiếp tục.</p>
    </section>
  </main>;
  return <div className="shell"><aside><Brand/><span className="eyebrow side-label">HỘ KINH DOANH</span><label className="sr-only" htmlFor="tenant">Chọn hộ kinh doanh</label><select id="tenant" value={tenant} onChange={e=>{setTenant(e.target.value);setNotice('');}}>{!tenant&&<option value="">Chưa có hộ</option>}{me?.memberships.filter(m=>m.status==='ACTIVE').map(m=><option key={m.id} value={m.tenant_id}>{m.tenant_name}</option>)}</select><nav aria-label="Điều hướng"><button aria-label="Địa điểm" className={tab==='sites'?'active':''} onClick={()=>setTab('sites')}><Icon name="store"/>Địa điểm</button>{owner&&<><button aria-label="Nhân sự" className={tab==='staff'?'active':''} onClick={()=>setTab('staff')}><Icon name="people"/>Nhân sự</button><button aria-label="Lịch sử thao tác" className={tab==='audit'?'active':''} onClick={()=>setTab('audit')}><Icon name="history"/>Lịch sử thao tác</button></>}</nav></aside><div className="workspace"><header className="topbar"><span>{current?.tenant_name??'Tài khoản'} <i>/</i> {tab==='sites'?'Địa điểm':tab==='staff'?'Nhân sự':'Lịch sử'}</span><div className="user"><div className="avatar">{session.user.username.slice(0,1).toUpperCase()}</div><span>{session.user.username}<small>{current?roleLabel[current.role]:'Tài khoản cá nhân'}</small></span><button className="quiet" onClick={()=>void action(async()=>{const result=await api('/auth/logout','POST',{});window.location.assign(result.redirectUrl);})}>Đăng xuất</button></div></header><main className="content"><div className="page-heading"><div><h1>{tab==='sites'?'Địa điểm kinh doanh':tab==='staff'?'Nhân sự':'Lịch sử thao tác'}</h1><p>{tab==='sites'?'Quản lý thông tin và trạng thái hoạt động của từng địa điểm.':tab==='staff'?'Quản lý vai trò, địa điểm làm việc và quyền truy cập.':'Các thay đổi về địa điểm, nhân sự và quyền truy cập.'}</p></div><div className="heading-actions">{tab==='sites'?<><button className="button secondary" onClick={()=>open('tenant')}>Tạo hộ kinh doanh</button>{owner&&<button className="button primary" onClick={()=>open('site')}>+ Thêm địa điểm</button>}</>:tab==='staff'?<button className="button primary" onClick={()=>open('invite')}>+ Mời nhân viên</button>:null}</div></div>
    {error&&<div role="alert" className="alert error">{error}<button aria-label="Đóng thông báo lỗi" onClick={()=>setError('')}>×</button></div>}{notice&&<div role="status" className="alert success">{notice}</div>}
    {session.context?.tenantId===tenant&&<div className="context"><span className="dot"/>Địa điểm đang chọn: <strong>{session.context.siteName}</strong></div>}
    {tab==='sites'&&<><div className="stats"><Stat label="Tổng địa điểm" value={sites.length}/><Stat label="Đang sẵn sàng" value={sites.filter(s=>s.status==='ACTIVE').length}/><Stat label="Chờ khởi tạo" value={sites.filter(s=>s.status==='PROVISIONING').length}/></div>{tenant?<div className="site-grid">{sites.map(s=><article className="site-card" key={s.id}><div className="card-top"><span className="site-icon"><Icon name="store"/></span><span className={'badge '+s.status.toLowerCase()}>{statusLabel[s.status]}</span></div><span className="site-code">{s.code}</span><h2>{s.name}</h2><p className="address">{s.address||'Chưa có địa chỉ'}</p><div className="readiness"><span><i className={s.warehouse_ready?'ready':'pending'}/>{s.warehouse_ready?'Kho đã sẵn sàng':'Đang tạo kho'}</span><span><i className={s.register_ready?'ready':'pending'}/>{s.register_ready?'Quầy đã sẵn sàng':'Đang tạo quầy'}</span></div><div className="card-actions"><button className="button secondary" disabled={s.status!=='ACTIVE'||busy} onClick={()=>void action(async()=>{const context=await api('/v1/context','POST',{tenantId:tenant,siteId:s.id});setSession({...session,context});setNotice(`Đã chọn ${s.name}.`);})}>Chọn làm việc</button>{['OWNER','MANAGER'].includes(current?.role??'')&&<button className="quiet" disabled={s.status==='PROVISIONING'} onClick={()=>{setEditing(s);open('edit');}}>Chỉnh sửa</button>}</div></article>)}</div>:<div className="empty"><Icon name="store"/><h2>Bạn chưa có hộ kinh doanh</h2><p>Tạo hộ kinh doanh hoặc nhận lời mời từ chủ hộ để bắt đầu làm việc.</p><button className="button primary" onClick={()=>open('tenant')}>Tạo hộ kinh doanh</button></div>}<div className="account-card"><div><b>Mã tài khoản của bạn</b><code>{session.user.subjectId}</code><p>Gửi mã này cho chủ hộ để được xác nhận đúng người nhận lời mời.</p></div><button className="button secondary" onClick={()=>open('accept')}>Nhận lời mời</button></div></>}
    {tab==='staff'&&<div className="table-wrap"><table><thead><tr><th>Thành viên</th><th>Vai trò</th><th>Phạm vi</th><th>Trạng thái</th><th/></tr></thead><tbody>{staff.map(m=><tr key={m.id}><td><strong>{m.subject_id===session.user.subjectId?'Bạn':`Thành viên ${m.subject_id.slice(-4)}`}</strong><code>{m.subject_id}</code></td><td>{roleLabel[m.role]}</td><td>{m.role==='OWNER'?'Toàn hộ':m.site_ids.map(id=>sites.find(s=>s.id===id)?.name??id).join(', ')}</td><td><span className={'badge '+(m.status==='ACTIVE'?'active':'suspended')}>{m.status==='ACTIVE'?'Hoạt động':'Đã khóa'}</span></td><td>{m.role!=='OWNER'&&<button className="quiet" onClick={()=>{setMember(m);open('member');}}>Sửa quyền</button>}</td></tr>)}</tbody></table></div>}
    {tab==='audit'&&<div className="table-wrap"><table><thead><tr><th>Thời gian</th><th>Hành động</th><th>Người thực hiện</th><th>Đối tượng</th></tr></thead><tbody>{audit.map(a=><tr key={a.id}><td>{new Date(a.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</td><td>{({TENANT_CREATED:'Tạo hộ',SITE_CREATED:'Thêm địa điểm',SITE_ACTIVATED:'Địa điểm sẵn sàng',SITE_UPDATED:'Sửa địa điểm',INVITATION_CONFIRMED:'Xác nhận lời mời',INVITATION_ACCEPTED:'Nhận lời mời',MEMBERSHIP_UPDATED:'Cập nhật quyền'} as Record<string,string>)[a.action]??a.action}</td><td><code>{a.actor}</code></td><td><code>{a.entity_id}</code></td></tr>)}</tbody></table></div>}
    </main></div>
    {dialog&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget&&!busy)setDialog('');}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header><h2 id="dialog-title">{{tenant:'Tạo hộ kinh doanh',site:'Thêm địa điểm',edit:'Chỉnh sửa địa điểm',invite:'Mời nhân viên',accept:'Nhận lời mời',member:'Cập nhật quyền'}[dialog]}</h2><button aria-label="Đóng" className="quiet" disabled={busy} onClick={()=>setDialog('')}>×</button></header>{error&&<div role="alert" className="alert error">{error}</div>}
    {inviteToken?<div><p>Chuyển mã này trực tiếp cho người đã xác nhận. Mã chỉ hiển thị trong lần tạo và hết hạn sau 48 giờ.</p><label>Mã lời mời<textarea readOnly value={inviteToken}/></label><button className="button primary" onClick={()=>{setInviteToken('');setDialog('');}}>Đã lưu mã</button></div>:<form onSubmit={submit}>
      {dialog==='tenant'&&<><label>Tên hộ kinh doanh<input name="name" required maxLength={120} placeholder="Ví dụ: Hộ kinh doanh An Bình"/></label><label>Liên hệ<input name="contact" maxLength={250}/></label><div className="form-divider">Địa điểm đầu tiên</div><label>Tên địa điểm<input name="siteName" required maxLength={120}/></label></>}
      {['site','edit'].includes(dialog)&&<label>Tên địa điểm<input name="name" required defaultValue={editing&&dialog==='edit'?editing.name:''} maxLength={120}/></label>}
      {['tenant','site'].includes(dialog)&&<div><label htmlFor="site-code">Mã địa điểm</label><input id="site-code" name="code" aria-describedby="site-code-help" required minLength={2} maxLength={32} pattern="[A-Za-z0-9_-]+" placeholder="CH01"/><small id="site-code-help">Chữ, số, dấu gạch ngang hoặc gạch dưới; duy nhất trong hộ.</small></div>}
      {['tenant','site','edit'].includes(dialog)&&<label>Địa chỉ<input name="address" maxLength={250} defaultValue={dialog==='edit'?editing?.address:''}/></label>}
      {dialog==='edit'&&<label>Trạng thái<select name="status" defaultValue={editing?.status}><option value="ACTIVE">Sẵn sàng</option><option value="SUSPENDED">Tạm ngừng</option></select></label>}
      {dialog==='invite'&&<label>Mã tài khoản người nhận<input name="subject" required placeholder="Mã người nhận gửi cho chủ hộ"/></label>}
      {['invite','member'].includes(dialog)&&<><label>Vai trò<select name="role" defaultValue={dialog==='member'?member?.role:'CASHIER'}>{['MANAGER','CASHIER','STOCK','ACCOUNTANT'].map(role=><option key={role} value={role}>{roleLabel[role]}</option>)}</select></label><fieldset><legend>Địa điểm được làm việc</legend>{sites.map(s=><label className="check" key={s.id}><input type="checkbox" name="sites" value={s.id} defaultChecked={dialog==='member'&&member?.site_ids.includes(s.id)}/>{s.name}</label>)}</fieldset></>}
      {dialog==='member'&&<div><label htmlFor="member-status">Trạng thái thành viên</label><select id="member-status" name="status" defaultValue={member?.status}><option value="ACTIVE">Hoạt động</option><option value="BLOCKED">Đã khóa</option></select></div>}
      {dialog==='invite'&&<label className="check"><input type="checkbox" name="confirmed" required/>Tôi đã xác nhận mã tài khoản thuộc đúng người nhận.</label>}
      {dialog==='accept'&&<label>Mã lời mời<textarea name="token" required placeholder="Dán mã chủ hộ đã cung cấp"/></label>}
      <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>setDialog('')}>Hủy</button><button className="button primary" disabled={busy}>{busy?'Đang xử lý…':dialog==='member'?'Lưu quyền':dialog==='accept'?'Xác nhận nhận lời mời':dialog==='invite'?'Tạo lời mời':dialog==='edit'?'Lưu thay đổi':'Tạo mới'}</button></div>
    </form>}</section></div>}
  </div>;
}
function Brand(){return <div className="brand"><img src="/brand/Logo_Storeluma.png" alt="Storeluma" width="220" height="56"/></div>;}
function Icon({name}:{name:'store'|'people'|'history'}){
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name==='store'?<><path d="M3 10h18l-2-6H5l-2 6Z"/><path d="M4 10v10h16V10M9 20v-6h6v6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/></>:name==='people'?<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 4v2"/></>:<><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/></>}
  </svg>;
}
function Stat({label,value}:{label:string,value:number}){return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;}
createRoot(document.getElementById('root')!).render(<App/>);
