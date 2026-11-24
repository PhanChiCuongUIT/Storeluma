import React,{useEffect,useState} from "react";
import {t} from "./i18n";
import {useCommand,when} from "./after-sales";
type Row=Record<string,any>;
export function Reconciliation({api,path,site}:{api:(path:string,method?:string,data?:unknown,key?:string)=>Promise<any>;path:string;site:string}){
  const [rows,setRows]=useState<Row[]>([]),[source,setSource]=useState(""),[query,search]=useState(""),[revision,refresh]=useState(0);
  const [selected,setSelected]=useState<Row|null>(null),[timeline,setTimeline]=useState<Row[]>([]),[error,setError]=useState("");
  const {command,busy,run,error:actionError}=useCommand(api,path);
  useEffect(()=>{let live=true;setRows([]);setSelected(null);setError("");
    async function load(){let cursor=null;const all=[];
      do{const d=await api(path+"/reconciliation-cases?siteId="+site+(query?"&source="+encodeURIComponent(query):"")+(cursor?"&cursor="+cursor:""));all.push(...d.items);cursor=d.nextCursor;}while(cursor);
      if(live)setRows(all);
    }
    void load().catch(e=>{if(live)setError(e.message);});return()=>{live=false;};
  },[site,path,query,revision]);
  return <section className="data-panel customer-panel"><h2>{t("Đối soát giao dịch")}</h2>
    <form onSubmit={e=>{e.preventDefault();search(source.trim());refresh(v=>v+1);}}><label>{t("Mã đơn hoặc mã thanh toán")}<input value={source} onChange={e=>setSource(e.target.value)}/></label><button className="button secondary">{t("Tra cứu")}</button></form>
    {(error||actionError)&&<p role="alert">{t(error||actionError)}</p>}
    {!rows.length&&<p>{t("Chưa có hồ sơ đối soát tại địa điểm này.")}</p>}
    {rows.map(c=><p key={c.id}><code>{c.order_id}</code> · {c.stage} · {c.status} <button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{const a=await api(path+"/reconciliation-cases/"+c.id+"/timeline");setTimeline(a);setSelected(c);})}>{t("Xem chi tiết")}</button></p>)}
    {selected&&<div><p>{t(selected.last_error??"")} · {when(selected.updated_at)}</p>{timeline.map((a,i)=><p key={i}>{when(a.created_at)} · {a.action}</p>)}
      {selected.status!=="RESOLVED"&&<form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(async()=>{await command("/reconciliation-cases/"+selected.id+"/actions",{version:selected.version,reason:data.get("reason"),action:data.get("action")});refresh(v=>v+1);});}}>
        <label>{t("Thao tác")}<select name="action"><option value="RETRY_STEP">{t("Thử lại bước hiện tại")}</option>{!selected.return_id&&<option value="REQUEST_COMPENSATION">{t("Yêu cầu hủy trước khi thu tiền")}</option>}</select></label>
        <label>{t("Lý do")}<input required name="reason" minLength={3} maxLength={500}/></label><button disabled={busy} className="button primary">{t("Ghi nhận yêu cầu")}</button></form>}</div>}
  </section>;
}
