import React,{useEffect,useState} from "react";
import {t} from "./i18n";
import {useCommand,when} from "./after-sales";
import {Reconciliation} from "./reconciliation";
type Row=Record<string,any>;
type Props={api:(p:string,m?:string,b?:unknown,k?:string)=>Promise<any>;tenant:string;sites:Row[];owner:boolean;operator:boolean};
export function Operations({api,tenant,sites,owner,operator}:Props){
  const [grants,setGrants]=useState<Row[]>([]),[assigned,setAssigned]=useState<Row[]>([]),[selected,select]=useState("");
  const [service,setService]=useState("finance"),[letters,setLetters]=useState<Row[]>([]),[backlog,setBacklog]=useState(0);
  const [revision,refresh]=useState(0),[error,fail]=useState(""),[state,setState]=useState<Row|null>(null);
  const [trail,setTrail]=useState<Row[]|null>(null);
  const {busy,run,command,error:actionError}=useCommand(api,"/v1/ops");
  useEffect(()=>{let live=true;fail("");setGrants([]);setAssigned([]);setLetters([]);setTrail(null);
    async function load(){
      if(owner){const g=await api("/v1/ops/support-grants?tenantId="+tenant);if(live)setGrants(g);}
      if(operator){
        const g=await api("/v1/ops/support-grants");const all=[];let cursor=null;
        do{const d=await api("/v1/ops/services/"+service+"/dead-letters"+(cursor?"?cursor="+cursor:""));
          if(live)setBacklog(d.backlog.pending);all.push(...d.items);cursor=d.nextCursor;}while(cursor);
        if(live){setAssigned(g);setLetters(all);}
      }
    }
    void load().catch(e=>{if(live)fail(e.message);});return()=>{live=false;};
  },[tenant,owner,operator,revision,service]);
  const [grantId,siteId]=selected.split("/");const active=assigned.find(g=>g.id===grantId);
  return <section className="data-panel customer-panel">
    {(error||actionError)&&<p role="alert">{t(error||actionError)}</p>}
    {owner&&<><h2>{t("Tra cứu chứng từ")}</h2><form onSubmit={e=>{e.preventDefault();const id=new FormData(e.currentTarget).get("id");void run(async()=>setTrail(await api("/v1/tenants/"+tenant+"/audit-trail?source="+encodeURIComponent(String(id)))));}}>
      <label>{t("Mã chứng từ")}<input name="id" required/></label><button className="button secondary" disabled={busy}>{t("Tra cứu")}</button></form>
      {trail&&(!trail.length?<p>{t("Chưa có hoạt động cho chứng từ này.")}</p>:trail.map(a=><p key={a.service+a.id}>{when(a.created_at)} · {a.service} · {a.action}</p>))}
      <h2>{t("Quyền hỗ trợ")}</h2><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{
        await command("/support-grants",{targetTenantId:tenant,operatorSubject:f.get("subject"),siteIds:[f.get("site")],
          actions:f.has("write")?["reconciliation.read","reconciliation.manage"]:["reconciliation.read"],expiresAt:new Date(Date.now()+Number(f.get("hours"))*3600000).toISOString(),reason:f.get("reason")});refresh(v=>v+1);});}}>
        <label>{t("Mã người vận hành")}<input name="subject" required/></label>
        <label>{t("Địa điểm")}<select name="site" required>{sites.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        <label>{t("Thời hạn (giờ)")}<input type="number" name="hours" defaultValue={1} min={1} max={24} required/></label>
        <label><input name="write" type="checkbox"/>{t("Cho phép yêu cầu xử lý đối soát")}</label><label>{t("Lý do")}<input name="reason" minLength={3} maxLength={500} required/></label>
        <button className="button primary" disabled={busy||!sites.length}>{t("Cấp quyền hỗ trợ")}</button></form>
      {grants.map(g=><p key={g.id}>{g.operator_subject} · {when(g.expires_at)} <button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await command("/support-grants/"+g.id+"/revoke",{targetTenantId:tenant,reason:"Chủ hộ kết thúc hỗ trợ"});refresh(v=>v+1);})}>{t("Thu hồi")}</button></p>)}</>}
    {operator&&<><h2>{t("Vận hành nền tảng")}</h2>
      <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>setState(await api("/v1/ops/tenants/"+encodeURIComponent(String(f.get("tenant"))))));}}>
        <label>{t("Mã hộ kinh doanh")}<input required name="tenant"/></label><button disabled={busy}>{t("Tra cứu")}</button></form>
      {state&&<form onSubmit={e=>{e.preventDefault();const reason=new FormData(e.currentTarget).get("reason");void run(async()=>{const v=await command("/tenants/"+state.id+"/status",{version:state.version,status:state.operational_status==="ACTIVE"?"SUSPENDED":"ACTIVE",reason});setState({...state,...v});});}}>
        <p>{state.id} · {state.operational_status}</p><label>{t("Lý do")}<input name="reason" minLength={3} maxLength={500} required/></label><button disabled={busy}>{state.operational_status==="ACTIVE"?t("Tạm dừng giao dịch mới"):t("Mở lại giao dịch")}</button></form>}
      <label>{t("Dịch vụ")}<select value={service} onChange={e=>setService(e.target.value)}>{["business","catalog","inventory","sales","finance","reporting","notification"].map(s=><option key={s}>{s}</option>)}</select></label>
      <p>{t("Sự kiện chờ phát")} · {backlog}</p><button className="button secondary" onClick={()=>refresh(v=>v+1)}>{t("Làm mới")}</button>
      {letters.map(l=><form key={l.id} onSubmit={e=>{e.preventDefault();const reason=new FormData(e.currentTarget).get("reason");void run(async()=>{await command("/services/"+service+"/dead-letters/"+l.id+"/replay",{version:l.version,reason});refresh(v=>v+1);});}}>
        <p>{l.event_id??l.id} · {l.reason} · {l.status}</p>{l.status==="PARKED"&&l.event_id&&<><label>{t("Lý do")}<input name="reason" minLength={3} required/></label><button disabled={busy}>{t("Phát lại sự kiện")}</button></>}</form>)}
      <label>{t("Phạm vi hỗ trợ")}<select value={selected} onChange={e=>select(e.target.value)}><option value="">{t("Chọn địa điểm")}</option>
        {assigned.flatMap(g=>g.site_ids.map((s:string)=><option key={g.id+s} value={g.id+"/"+s}>{g.tenant_id} · {s}</option>))}</select></label>
      {active&&siteId&&<Reconciliation key={selected} path={"/v1/tenants/"+active.tenant_id} site={siteId} api={api} readOnly={!active.actions.includes("reconciliation.manage")}/>}
    </>}
  </section>;
}
