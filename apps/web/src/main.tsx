import React,{useState,useEffect,useRef,type FormEvent} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import './product.css';
import {Commerce} from './commerce';
import {StockRoom} from './stock';
import {SalesRoom} from './sales';
type Membership={id:string,tenant_id:string,tenant_name:string,subject_id:string,role:string,status:string,site_ids:string[],version:number};
type Site={id:string,tenant_id:string,name:string,code:string,address:string,status:string,warehouse_ready:boolean,register_ready:boolean,version:number};
type User={subjectId:string,username:string,memberships:Membership[]};
type Session={csrf:string,user:{subjectId:string,username:string},context?:{siteName:string,siteId:string,tenantId:string},expiresAt:number};
type IconName='store'|'people'|'history'|'search'|'grid'|'list'|'plus'|'arrow'|'pin'|'check'|'pause'|'clock'|'copy'|'logout'|'chevron'|'shield';
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
const roleLabel:Record<string,string>={OWNER:'Chủ hộ',MANAGER:'Quản lý',CASHIER:'Thu ngân',STOCK:'Nhân viên kho',ACCOUNTANT:'Tài chính'};
const statusLabel:Record<string,string>={ACTIVE:'Sẵn sàng',PROVISIONING:'Đang khởi tạo',SUSPENDED:'Tạm ngừng'};
function App(){
  const [session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(true),[me,setMe]=useState<User|null>(null);
  const [tenant,setTenant]=useState(''),[sites,setSites]=useState<Site[]>([]),[staff,setStaff]=useState<Membership[]>([]),[audit,setAudit]=useState<any[]>([]);
  const [orderLink,setOrderLink]=useState('');
  const [tab,setTab]=useState('sites'),[dialog,setDialog]=useState(''),[error,setError]=useState(()=>{
    const reason=new URLSearchParams(window.location.search).get('auth');
    return reason==='expired'?'Lượt đăng nhập đã hết hạn hoặc đã được sử dụng. Chọn Đăng nhập vào Storeluma để tiếp tục.':reason==='failed'?'Chưa xác minh được đăng nhập. Vui lòng bắt đầu lại.':'';
  }),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [editing,setEditing]=useState<Site|null>(null),[member,setMember]=useState<Membership|null>(null),[inviteToken,setInviteToken]=useState('');
  const [query,setQuery]=useState(''),[statusFilter,setStatusFilter]=useState('ALL'),[view,setView]=useState<'grid'|'list'>('grid');
  const modalRef=useRef<HTMLElement>(null),busyRef=useRef(false);busyRef.current=busy;
  const requestKey=useRef({payload:'',key:''});
  const current=me?.memberships.find(m=>m.tenant_id===tenant&&m.status==='ACTIVE');
  const owner=current?.role==='OWNER';
  const selectedSite=session?.context?.tenantId===tenant?sites.find(s=>s.id===session.context?.siteId&&s.status==='ACTIVE'):undefined;
  const visibleSites=sites.filter(s=>(statusFilter==='ALL'||s.status===statusFilter)&&normalize(`${s.code} ${s.name} ${s.address}`).includes(normalize(query.trim())));
  const commerceTab=['products','suppliers','receipts','stock','orders'].includes(tab);
  const pageTitle=({sites:'Địa điểm kinh doanh',staff:'Nhân sự',audit:'Lịch sử thao tác',products:'Hàng hóa',suppliers:'Nhà cung cấp',receipts:'Nhập hàng',stock:'Kho hàng',orders:'Đơn bán hàng'} as Record<string,string>)[tab];
  useEffect(()=>{setQuery('');setStatusFilter('ALL');},[tenant]);
  useEffect(()=>{
    if(!dialog)return;
    const previous=document.activeElement as HTMLElement,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const timer=requestAnimationFrame(()=>modalRef.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus());
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!busyRef.current){event.preventDefault();setDialog('');}
      if(event.key==='Tab'){
        const nodes=Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')??[]);
        const first=nodes[0],last=nodes.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',keydown);
    return()=>{cancelAnimationFrame(timer);document.removeEventListener('keydown',keydown);document.body.style.overflow=overflow;previous?.isConnected&&previous.focus();};
  },[dialog]);
  async function api(path:string,method='GET',data?:unknown,key?:string){
    const response=await fetch(path,{method,headers:{'content-type':'application/json',...(session?{'x-csrf-token':session.csrf}:{}),...(key?{'idempotency-key':key}:{})},body:data===undefined?undefined:JSON.stringify(data)}).catch(()=>{throw new Error('Không kết nối được máy chủ. Kiểm tra kết nối và thử lại.');});
    const body=await response.json();
    if(!response.ok){if(response.status===401){setSession(null);setMe(null);}throw new Error(body.message??'Không thể xử lý.');}return body;
  }
  async function refresh(){const user=await api('/v1/me') as User;setMe(user);return user;}
  useEffect(()=>{fetch('/auth/session').then(async r=>{if(r.ok)setSession(await r.json());}).catch(()=>setError('Không kết nối được với máy chủ.')).finally(()=>setLoading(false));},[]);
  useEffect(()=>{if(session)void refresh().catch(e=>setError(e.message));},[session?.csrf]);
  useEffect(()=>{if(!me)return;const active=me.memberships.filter(m=>m.status==='ACTIVE');setTenant(selected=>active.some(m=>m.tenant_id===selected)?selected:active[0]?.tenant_id??'');},[me]);
  useEffect(()=>{
    setSites([]);setStaff([]);setAudit([]);if(!tenant||!session)return;
    let alive=true,inFlight=false;const load=async()=>{
      if(inFlight)return;inFlight=true;
      try{
        const [rows,user,latest]=await Promise.all([api(`/v1/tenants/${tenant}/sites`),api('/v1/me'),api('/auth/session')]);
        if(alive){setSites(rows);setMe(user);setSession(latest);}
      }catch(e){if(alive){setSites([]);setStaff([]);setAudit([]);setError((e as Error).message);void refresh().catch(()=>{});}}
      finally{inFlight=false;}
    };
    void load();const timer=setInterval(load,2500);return()=>{alive=false;clearInterval(timer);};
  },[tenant,session?.csrf]);
  useEffect(()=>{
    if(!tenant||!owner){if(!tenant||['staff','audit'].includes(tab))setTab('sites');setStaff([]);setAudit([]);return;}
    let alive=true;const path=tab==='staff'?'memberships':tab==='audit'?'audit':null;
    if(path)void api(`/v1/tenants/${tenant}/${path}`).then(rows=>{if(alive){if(path==='audit')setAudit(rows);else setStaff(rows);}}).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;};
  },[tenant,tab,owner,notice]);
  async function action(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function open(name:string){setDialog(name);setError('');setInviteToken('');requestKey.current={payload:'',key:''};}
  async function copy(value:string){await action(async()=>{await navigator.clipboard.writeText(value);setNotice('Đã sao chép mã.');});}
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
        if(!form.getAll('sites').length)throw new Error('Chọn ít nhất một địa điểm cho nhân viên.');
        const result=await api(`/v1/tenants/${tenant}/invitations`,'POST',{targetSubjectId:value('subject'),role:value('role'),siteIds:form.getAll('sites'),ownerConfirmed:form.has('confirmed')});setInviteToken(result.token);setNotice('Lời mời có hiệu lực 48 giờ, chỉ dùng một lần.');return;
      }else if(dialog==='accept'){
        await api('/v1/invitations/accept','POST',{token:value('token')});await refresh();setNotice('Đã tham gia hộ kinh doanh.');
      }else if(dialog==='member'&&member){
        if(!form.getAll('sites').length)throw new Error('Chọn ít nhất một địa điểm cho nhân viên.');
        await api(`/v1/tenants/${tenant}/memberships/${member.id}`,'PATCH',{role:value('role'),status:value('status'),siteIds:form.getAll('sites'),version:member.version});setStaff(await api(`/v1/tenants/${tenant}/memberships`));setNotice('Đã cập nhật quyền truy cập.');
      }
      setDialog('');requestKey.current={payload:'',key:''};
    });
  }
  if(loading)return <main className="loading"><Brand/><p>Đang mở Storeluma…</p></main>;
  if(!session)return <main className="sign-in-page">
    <section className="sign-in-card" aria-labelledby="sign-in-title">
      <div className="sign-in-brand"><Brand/></div>
      <h1 id="sign-in-title">Đăng nhập</h1>
      <p>Truy cập hộ kinh doanh và địa điểm làm việc của bạn.</p>
      <a className="button primary" href="/auth/login">Đăng nhập vào Storeluma<Icon name="arrow"/></a>
      {error&&<p role="alert" className="alert error">{error}</p>}
      <div className="sign-in-help"><Icon name="shield"/><span>Chuẩn bị tài khoản, mật khẩu và mã từ ứng dụng xác thực.</span></div>
    </section>
  </main>;
  return <div className="shell">
    <aside inert={Boolean(dialog)}>
      <Brand/>
      <div className="tenant-picker"><label htmlFor="tenant">Hộ kinh doanh</label><select id="tenant" aria-label="Chọn hộ kinh doanh" value={tenant} onChange={e=>{setTenant(e.target.value);setNotice('');setError('');}}>
        {!tenant&&<option value="">Chưa có hộ</option>}{me?.memberships.filter(m=>m.status==='ACTIVE').map(m=><option key={m.id} value={m.tenant_id}>{m.tenant_name}</option>)}
      </select></div>
      <span className="nav-label">QUẢN LÝ</span>
      <nav aria-label="Điều hướng">
        {current&&<button aria-label="Hàng hóa" aria-current={tab==='products'?'page':undefined} className={tab==='products'?'active':''} onClick={()=>setTab('products')}><Icon name="grid"/>Hàng hóa</button>}
        {current&&current.role!=='CASHIER'&&<><button aria-label="Nhà cung cấp" aria-current={tab==='suppliers'?'page':undefined} className={tab==='suppliers'?'active':''} onClick={()=>setTab('suppliers')}><Icon name="people"/>Nhà cung cấp</button><button aria-label="Nhập hàng" aria-current={tab==='receipts'?'page':undefined} className={tab==='receipts'?'active':''} onClick={()=>setTab('receipts')}><Icon name="list"/>Nhập hàng</button></>}
        {current&&current.role!=='STOCK'&&<button aria-label="Đơn bán" aria-current={tab==='orders'?'page':undefined} className={tab==='orders'?'active':''} onClick={()=>{setOrderLink('');setTab('orders');}}><Icon name="list"/>Đơn bán</button>}
        {current&&<button aria-label="Kho hàng" aria-current={tab==='stock'?'page':undefined} className={tab==='stock'?'active':''} onClick={()=>setTab('stock')}><Icon name="grid"/>Kho hàng</button>}
        <button aria-label="Địa điểm" aria-current={tab==='sites'?'page':undefined} className={tab==='sites'?'active':''} onClick={()=>setTab('sites')}><Icon name="store"/>Địa điểm</button>
        {owner&&<><button aria-label="Nhân sự" aria-current={tab==='staff'?'page':undefined} className={tab==='staff'?'active':''} onClick={()=>setTab('staff')}><Icon name="people"/>Nhân sự</button><button aria-label="Lịch sử thao tác" aria-current={tab==='audit'?'page':undefined} className={tab==='audit'?'active':''} onClick={()=>setTab('audit')}><Icon name="history"/>Lịch sử thao tác</button></>}
      </nav>
      <div className="sidebar-account"><span className="avatar">{session.user.username.slice(0,1).toUpperCase()}</span><div><strong>{session.user.username}</strong><small>{current?roleLabel[current.role]:'Tài khoản cá nhân'}</small></div></div>
    </aside>
    <div className="workspace" inert={Boolean(dialog)}>
      <header className="topbar"><div className="breadcrumb"><Icon name="store"/><span>{current?.tenant_name??'Tài khoản'}</span><Icon name="chevron"/><strong>{pageTitle}</strong></div><button className="quiet logout" disabled={busy} onClick={()=>void action(async()=>{const result=await api('/auth/logout','POST',{});window.location.assign(result.redirectUrl);})}><Icon name="logout"/>Đăng xuất</button></header>
      <main className="content" id="main-content">
        <div className="page-heading"><div><span className="eyebrow">{current?.tenant_name??'KHÔNG GIAN CỦA BẠN'}</span><h1>{pageTitle}</h1><p>{tab==='sites'?'Theo dõi địa điểm và chọn nơi làm việc trong ngày.':tab==='staff'?'Phân công đúng người, đúng địa điểm.':tab==='products'?'Thiết lập hàng bán và quy cách đóng gói.':tab==='suppliers'?'Quản lý thông tin và giao dịch với đối tác.':tab==='receipts'?'Nhận hàng, kiểm tra và ghi nhận vào kho.':tab==='stock'?'Theo dõi tồn, kiểm đếm và đối chiếu chứng từ.':tab==='orders'?'Tạo đơn, thu tiền và theo dõi hàng đã bán.':'Theo dõi những thay đổi trong hộ kinh doanh.'}</p></div><div className="heading-actions">{tab==='sites'?<><button className="button secondary" onClick={()=>open('tenant')}>Tạo hộ kinh doanh</button>{owner&&<button className="button primary" aria-label="+ Thêm địa điểm" onClick={()=>open('site')}><Icon name="plus"/>Thêm địa điểm</button>}</>:tab==='staff'?<button className="button primary" aria-label="+ Mời nhân viên" onClick={()=>open('invite')}><Icon name="plus"/>Mời nhân viên</button>:null}</div></div>
        {error&&<div role="alert" className="alert error">{error}<button aria-label="Đóng thông báo lỗi" onClick={()=>setError('')}>×</button></div>}
        {notice&&<div role="status" className="alert success"><Icon name="check"/><span>{notice}</span><button aria-label="Đóng thông báo" onClick={()=>setNotice('')}>×</button></div>}
        {commerceTab&&!['stock','orders'].includes(tab)&&current&&<Commerce key={`${tenant}:${tab}:${current.role}:${current.version}`} tab={tab} tenant={tenant} role={current.role} sites={sites} api={api} subjectId={session.user.subjectId}/>}
        {tab==='stock'&&current&&<StockRoom onOpenOrder={id=>{setOrderLink(id);setTab('orders');}} key={`${tenant}:${current.role}:${current.version}`} tenant={tenant} role={current.role} sites={sites} api={api} subjectId={session.user.subjectId}/>}
        {tab==='orders'&&current&&<SalesRoom key={`${tenant}:${current.role}:${current.version}`} tenant={tenant} role={current.role} sites={sites} api={api} initialOrderId={orderLink} subjectId={session.user.subjectId}/>}
        {selectedSite&&!commerceTab&&<div className="context"><span className="context-icon"><Icon name="pin"/></span><div><small>ĐỊA ĐIỂM ĐANG CHỌN</small><strong>{selectedSite.name}</strong></div><span className="context-code">{selectedSite.code}</span><span className="context-status"><i className="dot"/>Sẵn sàng làm việc</span></div>}
        {tab==='sites'&&<>
          <div className="stats">
            <Stat label="Tổng địa điểm" value={sites.length} icon="store" active={statusFilter==='ALL'} onClick={()=>setStatusFilter('ALL')}/>
            <Stat label="Đang sẵn sàng" value={sites.filter(s=>s.status==='ACTIVE').length} icon="check" active={statusFilter==='ACTIVE'} onClick={()=>setStatusFilter('ACTIVE')}/>
            <Stat label="Chờ khởi tạo" value={sites.filter(s=>s.status==='PROVISIONING').length} icon="clock" active={statusFilter==='PROVISIONING'} onClick={()=>setStatusFilter('PROVISIONING')}/>
            <Stat label="Tạm ngừng" value={sites.filter(s=>s.status==='SUSPENDED').length} icon="pause" active={statusFilter==='SUSPENDED'} onClick={()=>setStatusFilter('SUSPENDED')}/>
          </div>
          {tenant?<section className="locations" aria-label="Danh sách địa điểm">
            <div className="section-heading"><h2>Danh sách địa điểm <span>{sites.length}</span></h2><span className="result-count">{visibleSites.length} địa điểm hiển thị</span></div>
            <div className="list-toolbar"><label className="search-field"><Icon name="search"/><input type="search" aria-label="Tìm địa điểm" placeholder="Tìm theo tên, mã hoặc địa chỉ…" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="toolbar-options"><select aria-label="Lọc trạng thái" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="ALL">Tất cả trạng thái</option>{Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><div className="view-switch" aria-label="Cách hiển thị"><button aria-label="Xem dạng thẻ" aria-pressed={view==='grid'} onClick={()=>setView('grid')}><Icon name="grid"/></button><button aria-label="Xem dạng danh sách" aria-pressed={view==='list'} onClick={()=>setView('list')}><Icon name="list"/></button></div></div></div>
            {visibleSites.length?<div className={'site-grid '+(view==='list'?'list-view':'')}>{visibleSites.map(s=><article className={'site-card '+(selectedSite?.id===s.id?'selected':'')} key={s.id}>
              <div className="card-top"><span className="site-icon"><Icon name="store"/></span><span className={'badge '+s.status.toLowerCase()}><i/>{statusLabel[s.status]}</span></div>
              <div className="site-info"><span className="site-code">{s.code}</span><h2>{s.name}</h2><p className="address"><Icon name="pin"/>{s.address||'Chưa có địa chỉ'}</p></div>
              <div className="readiness"><span><Icon name={s.warehouse_ready?'check':'clock'}/>{s.warehouse_ready?'Kho đã sẵn sàng':'Đang tạo kho'}</span><span><Icon name={s.register_ready?'check':'clock'}/>{s.register_ready?'Quầy đã sẵn sàng':'Đang tạo quầy'}</span></div>
              <div className="card-actions"><button className={'button '+(selectedSite?.id===s.id?'chosen':'secondary')} aria-label="Chọn làm việc" aria-pressed={selectedSite?.id===s.id} disabled={s.status!=='ACTIVE'||busy} onClick={()=>void action(async()=>{const context=await api('/v1/context','POST',{tenantId:tenant,siteId:s.id});setSession({...session,context});setNotice(`Đã chọn ${s.name}.`);})}>{selectedSite?.id===s.id?<><Icon name="check"/>Đang chọn</>:<>Chọn làm việc<Icon name="arrow"/></>}</button>{['OWNER','MANAGER'].includes(current?.role??'')&&<button className="quiet" disabled={s.status==='PROVISIONING'} onClick={()=>{setEditing(s);open('edit');}}>Chỉnh sửa</button>}</div>
            </article>)}</div>:<div className="empty filter-empty"><Icon name="search"/><h3>Không tìm thấy địa điểm</h3><p>Thử tên, mã khác hoặc bỏ bộ lọc trạng thái.</p><button className="button secondary" onClick={()=>{setQuery('');setStatusFilter('ALL');}}>Xóa bộ lọc</button></div>}
          </section>:<div className="empty"><Icon name="store"/><h2>Bạn chưa có hộ kinh doanh</h2><p>Tạo hộ kinh doanh hoặc nhận lời mời từ chủ hộ để bắt đầu làm việc.</p><button className="button primary" onClick={()=>open('tenant')}>Tạo hộ kinh doanh</button></div>}
          <div className="account-card"><span className="account-symbol"><Icon name="people"/></span><div><b>Kết nối với hộ kinh doanh</b><p>Gửi mã tài khoản của bạn cho chủ hộ để nhận lời mời.</p><div className="account-id"><code>{session.user.subjectId}</code><button className="icon-button" aria-label="Sao chép mã tài khoản" onClick={()=>void copy(session.user.subjectId)}><Icon name="copy"/></button></div></div><button className="button secondary" onClick={()=>open('accept')}>Nhận lời mời<Icon name="arrow"/></button></div>
        </>}
        {tab==='staff'&&<section className="data-panel"><div className="section-heading"><h2>Thành viên <span>{staff.length}</span></h2><span className="result-count">{staff.filter(m=>m.status==='ACTIVE').length} đang hoạt động</span></div><div className="table-wrap"><table><thead><tr><th>Thành viên</th><th>Vai trò</th><th>Địa điểm được giao</th><th>Trạng thái</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{staff.map(m=><tr key={m.id}><td><div className="member-cell"><span className={'member-avatar '+(m.role==='OWNER'?'owner-avatar':'')}>{m.role==='OWNER'?<Icon name="shield"/>:<Icon name="people"/>}</span><div><strong>{m.subject_id===session.user.subjectId?`${session.user.username} (Bạn)`:`Thành viên ${m.subject_id.slice(-4)}`}</strong><details><summary>Mã tài khoản</summary><code>{m.subject_id}</code></details></div></div></td><td><span className="role-label">{roleLabel[m.role]}</span></td><td><div className="scope-tags">{m.role==='OWNER'?<span>Toàn hộ</span>:m.site_ids.map(id=><span key={id}>{sites.find(s=>s.id===id)?.name??id}</span>)}</div></td><td><span className={'badge '+(m.status==='ACTIVE'?'active':'suspended')}><i/>{m.status==='ACTIVE'?'Hoạt động':'Đã khóa'}</span></td><td>{m.role!=='OWNER'&&<button className="button secondary small" onClick={()=>{setMember(m);open('member');}}>Sửa quyền</button>}</td></tr>)}</tbody></table>{!staff.length&&<p className="table-empty">Đang tải danh sách thành viên…</p>}</div></section>}
        {tab==='audit'&&<section className="data-panel"><div className="section-heading"><h2>Hoạt động gần đây <span>{audit.length}</span></h2><span className="result-count">Tối đa 50 hoạt động mới nhất</span></div><div className="table-wrap"><table><thead><tr><th>Thời gian</th><th>Hành động</th><th>Người thực hiện</th><th>Đối tượng</th></tr></thead><tbody>{audit.map(a=><tr key={a.id}><td className="audit-time"><strong>{new Date(a.created_at).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit'})}</strong><small>{new Date(a.created_at).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</small></td><td><span className="audit-action"><span className="audit-mark"><Icon name={a.action.includes('SITE')?'store':a.action.includes('TENANT')?'store':'people'}/></span>{({TENANT_CREATED:'Tạo hộ',SITE_CREATED:'Thêm địa điểm',SITE_ACTIVATED:'Địa điểm sẵn sàng',SITE_UPDATED:'Sửa địa điểm',INVITATION_CONFIRMED:'Xác nhận lời mời',INVITATION_ACCEPTED:'Nhận lời mời',MEMBERSHIP_UPDATED:'Cập nhật quyền'} as Record<string,string>)[a.action]??a.action}</span></td><td title={a.actor}>{a.actor===session.user.subjectId?session.user.username:a.actor.startsWith('system:')?'Hệ thống':`Thành viên ${a.actor.slice(-4)}`}</td><td><span>{sites.find(s=>s.id===a.entity_id)?.name??(a.action==='TENANT_CREATED'?current?.tenant_name:a.action.startsWith('INVITATION')?'Lời mời nhân viên':'Quyền thành viên')}</span><details><summary>Mã đối tượng</summary><code>{a.entity_id}</code></details></td></tr>)}</tbody></table>{!audit.length&&<p className="table-empty">Chưa có hoạt động để hiển thị.</p>}</div></section>}
      </main>
    </div>
    {dialog&&<div className="overlay" onClick={e=>{if(e.target===e.currentTarget&&!busy)setDialog('');}}><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header><div><span className="eyebrow">{current?.tenant_name??'STORELUMA'}</span><h2 id="dialog-title">{{tenant:'Tạo hộ kinh doanh',site:'Thêm địa điểm',edit:'Chỉnh sửa địa điểm',invite:'Mời nhân viên',accept:'Nhận lời mời',member:'Cập nhật quyền'}[dialog]}</h2></div><button aria-label="Đóng" className="icon-button close-dialog" disabled={busy} onClick={()=>setDialog('')}>×</button></header>{error&&<div role="alert" className="alert error">{error}</div>}
      {inviteToken?<div><p>Chuyển mã này trực tiếp cho người đã xác nhận. Mã chỉ hiển thị trong lần tạo và hết hạn sau 48 giờ.</p><label htmlFor="invitation-token">Mã lời mời</label><textarea id="invitation-token" readOnly value={inviteToken}/><div className="form-actions"><button className="button secondary" onClick={()=>void copy(inviteToken)}><Icon name="copy"/>Sao chép mã</button><button className="button primary" onClick={()=>{setInviteToken('');setDialog('');}}>Đã lưu mã</button></div></div>:<form onSubmit={submit}>
        {dialog==='tenant'&&<><label>Tên hộ kinh doanh<input name="name" required maxLength={120} placeholder="Ví dụ: Hộ kinh doanh An Bình"/></label><label>Liên hệ<input name="contact" maxLength={250} placeholder="Số điện thoại hoặc thông tin liên hệ"/></label><div className="form-divider"><Icon name="store"/>Địa điểm đầu tiên</div><label>Tên địa điểm<input name="siteName" required maxLength={120} placeholder="Ví dụ: Cửa hàng Trung Tâm"/></label></>}
        {['site','edit'].includes(dialog)&&<label>Tên địa điểm<input name="name" required defaultValue={editing&&dialog==='edit'?editing.name:''} maxLength={120} placeholder="Ví dụ: Cửa hàng Trung Tâm"/></label>}
        {['tenant','site'].includes(dialog)&&<div><label htmlFor="site-code">Mã địa điểm</label><input id="site-code" name="code" aria-describedby="site-code-help" required minLength={2} maxLength={32} pattern="[A-Za-z0-9_-]+" placeholder="CH01"/><small id="site-code-help">2–32 ký tự chữ, số, dấu gạch ngang hoặc gạch dưới; duy nhất trong hộ.</small></div>}
        {['tenant','site','edit'].includes(dialog)&&<label>Địa chỉ<input name="address" maxLength={250} defaultValue={dialog==='edit'?editing?.address:''} placeholder="Địa chỉ cửa hàng"/></label>}
        {dialog==='edit'&&<label>Trạng thái<select name="status" defaultValue={editing?.status}><option value="ACTIVE">Sẵn sàng</option><option value="SUSPENDED">Tạm ngừng</option></select></label>}
        {dialog==='invite'&&<label>Mã tài khoản người nhận<input name="subject" required placeholder="Dán mã người nhận gửi cho bạn"/></label>}
        {['invite','member'].includes(dialog)&&<><label>Vai trò<select name="role" defaultValue={dialog==='member'?member?.role:'CASHIER'}>{['MANAGER','CASHIER','STOCK','ACCOUNTANT'].map(role=><option key={role} value={role}>{roleLabel[role]}</option>)}</select></label><fieldset><legend>Địa điểm được làm việc</legend>{sites.map(s=><label className="check" key={s.id}><input type="checkbox" name="sites" value={s.id} defaultChecked={dialog==='member'&&member?.site_ids.includes(s.id)}/>{s.name}</label>)}</fieldset></>}
        {dialog==='member'&&<div><label htmlFor="member-status">Trạng thái thành viên</label><select id="member-status" name="status" defaultValue={member?.status}><option value="ACTIVE">Hoạt động</option><option value="BLOCKED">Đã khóa</option></select></div>}
        {dialog==='invite'&&<label className="check confirmation"><input type="checkbox" name="confirmed" required/>Tôi đã xác nhận mã tài khoản thuộc đúng người nhận.</label>}
        {dialog==='accept'&&<label>Mã lời mời<textarea name="token" required placeholder="Dán mã chủ hộ đã cung cấp"/></label>}
        <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>setDialog('')}>Hủy</button><button className="button primary" disabled={busy}>{busy?'Đang xử lý…':dialog==='member'?'Lưu quyền':dialog==='accept'?'Xác nhận nhận lời mời':dialog==='invite'?'Tạo lời mời':dialog==='edit'?'Lưu thay đổi':'Tạo mới'}</button></div>
      </form>}
    </section></div>}
  </div>;
}
function Brand(){return <div className="brand"><img src="/brand/Logo_Storeluma.png" alt="Storeluma" width="220" height="56"/></div>;}
function Icon({name}:{name:IconName}){
  const paths:Record<IconName,React.ReactNode>={
    store:<><path d="M3 10h18l-2-6H5l-2 6Z"/><path d="M4 10v10h16V10M9 20v-6h6v6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/></>,
    people:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 4v2"/></>,
    history:<><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/></>,
    search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    grid:<><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
    list:<><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></>,
    plus:<path d="M12 5v14M5 12h14"/>,arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>,
    pin:<><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.3"/></>,
    check:<path d="m5 12 4 4L19 6"/>,pause:<><path d="M8 6v12M16 6v12"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    copy:<><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></>,
    logout:<><path d="M10 4H4v16h6M9 12h12m-5-5 5 5-5 5"/></>,
    chevron:<path d="m9 5 7 7-7 7"/>,shield:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Stat({label,value,icon,active,onClick}:{label:string,value:number,icon:IconName,active:boolean,onClick:()=>void}){return <button className={'stat '+(active?'stat-active':'')} aria-pressed={active} onClick={onClick}><div><span>{label}</span><strong>{value.toString().padStart(2,'0')}</strong></div><span className={'stat-icon '+icon}><Icon name={icon}/></span></button>;}
createRoot(document.getElementById('root')!).render(<App/>);
