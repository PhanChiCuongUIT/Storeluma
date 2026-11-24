import React, {useEffect, useState} from "react";
import {t, locale} from "./i18n";

type Customer = {id:string; name:string; phone?:string; email?:string; note:string; marketing_consent:boolean; status:string; version:number};
type History = {id:string; code:string; status:string; payable_vnd:string; created_at:string};
type Props = {
  path:string; site:string; role:string;
  api:(path:string,method?:string,body?:unknown,key?:string)=>Promise<any>;
  select?:(id:string,name:string)=>void;
};
export function CustomerPanel({path,site,role,api,select}:Props) {
  const [q,search]=useState(""),[rows,setRows]=useState<Customer[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [editing,edit]=useState<Customer|null>(null),[form,show]=useState(false),[history,setHistory]=useState<History[]|null>(null);
  const [error,fail]=useState(""),[busy,setBusy]=useState(false),[revision,refresh]=useState(0);
  const [duplicates,setDuplicates]=useState<Customer[]>([]),[phone,setPhone]=useState("");
  const endpoint=path+"/customers";
  const listUrl=endpoint+"?active="+Boolean(select)+"&q="+encodeURIComponent(q);
  useEffect(()=>{
    let live=true;
    setRows([]);setCursor(null);setHistory(null);fail("");
    const timer=setTimeout(()=>{api(listUrl).then(data=>{if(live){setRows(data.items);setCursor(data.nextCursor);}})
      .catch(e=>{if(live)fail(e.message);});},180);
    return ()=>{live=false;clearTimeout(timer);};
  },[listUrl,site,revision]);
  useEffect(()=>{
    let live=true;setDuplicates([]);
    if (!form || phone.trim().length<6) return;
    const timer=setTimeout(()=>void api(endpoint+"?q="+encodeURIComponent(phone)).then(data=>{
      if(live)setDuplicates(data.items.filter((c:Customer)=>c.id!==editing?.id));
    }).catch(e=>{if(live)fail(e.message);}),200);
    return ()=>{live=false;clearTimeout(timer);};
  },[phone,form,editing?.id,endpoint]);
  async function run(work:()=>Promise<void>) {
    if(busy)return;
    setBusy(true);fail("");
    try{await work();}catch(e){fail((e as Error).message);}finally{setBusy(false);}
  }
  function start(row:Customer|null){edit(row);setPhone(row?.phone??"");show(true);setHistory(null);}
  return <section className="data-panel customer-panel">
    <div className="section-heading"><h2>{t("Hồ sơ khách hàng")}</h2>{role!=="ACCOUNTANT"&&<button type="button" className="button secondary" onClick={()=>start(null)}>{t("Thêm khách hàng")}</button>}</div>
    {error&&<p className="alert" role="alert">{t(error)}</p>}
    <label>{t("Tìm theo tên hoặc điện thoại")}<input type="search" value={q} onChange={e=>search(e.target.value)}/></label>
    <ul>{rows.map(c=><li key={c.id}><strong>{c.name}</strong> {c.phone} {c.status==="INACTIVE"&&t("Ngừng hoạt động")}{" "}
      {select ? <button type="button" className="button secondary small" onClick={()=>select(c.id,c.name)}>{t("Chọn")}</button> : <>
        <button type="button" className="button secondary small" disabled={busy||!site} onClick={()=>void run(async()=>{
          edit(c);show(false);setHistory([]);const all:History[]=[];let cursor=null;
          do {const data=await api(endpoint+"/"+c.id+"/history?siteId="+site+(cursor?"&cursor="+cursor:""));all.push(...data.items);cursor=data.nextCursor;}while(cursor);
          setHistory(all);
        })}>{t("Lịch sử mua")}</button>
        {role!=="ACCOUNTANT"&&<button type="button" className="button secondary small" onClick={()=>start(c)}>{t("Chỉnh sửa")}</button>}
      </>}</li>)}</ul>
    {cursor&&<button type="button" disabled={busy} onClick={()=>void run(async()=>{const d=await api(listUrl+"&cursor="+cursor);setRows([...rows,...d.items]);setCursor(d.nextCursor);})}>{t("Xem thêm")}</button>}
    {history&&<div><h3>{t("Lịch sử mua")} · {editing?.name}</h3>{!history.length&&<p>{t("Chưa có đơn tại địa điểm này.")}</p>}
      {history.map(o=><p key={o.id}>{o.code} · {new Date(o.created_at).toLocaleDateString(locale())} · {BigInt(o.payable_vnd).toLocaleString(locale())} ₫ · {t(({DRAFT:"Đơn nháp",PENDING:"Chờ thu tiền",COMMITTING:"Đang xuất kho",COMPLETED:"Hoàn tất",CANCELLED:"Đã hủy",REVIEW:"Đang đối chiếu"} as Record<string,string>)[o.status])}</p>)}</div>}
    {form&&<form key={editing?.id??"new"} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{
      const data={name:f.get("name"),phone,email:f.get("email"),note:f.get("note"),marketingConsent:f.has("consent"),
        ...(editing?{version:editing.version,status:f.get("active")?"ACTIVE":"INACTIVE"}:{})};
      const saved=await api(endpoint+(editing?"/"+editing.id:""),editing?"PATCH":"POST",data,crypto.randomUUID());
      show(false);refresh(v=>v+1);if(select)select(saved.id,String(data.name));
    });}}>
      <label>{t("Tên khách hàng")}<input required name="name" maxLength={120} defaultValue={editing?.name}/></label>
      <label>{t("Điện thoại")}<input type="tel" value={phone} maxLength={32} onChange={e=>setPhone(e.target.value)}/></label>
      {duplicates.length>0&&<p>{t("Số điện thoại tương tự")} · {duplicates.map(c=>c.name).join(", ")}</p>}
      <label>Email<input name="email" type="email" maxLength={254} defaultValue={editing?.email??""}/></label>
      <label>{t("Ghi chú")}<input name="note" maxLength={500} defaultValue={editing?.note}/></label>
      <label><input name="consent" type="checkbox" defaultChecked={editing?.marketing_consent}/>{t("Đồng ý nhận thông tin tiếp thị")}</label>
      {editing&&<label><input type="checkbox" name="active" defaultChecked={editing.status==="ACTIVE"}/>{t("Đang hoạt động")}</label>}
      <button className="button primary" disabled={busy}>{t("Lưu")}</button> <button type="button" className="button secondary" onClick={()=>show(false)}>{t("Đóng")}</button>
    </form>}
    {editing&&form&&role==="OWNER"&&<details><summary>{t("Ẩn danh hồ sơ")}</summary><form onSubmit={e=>{
      e.preventDefault();const reason=new FormData(e.currentTarget).get("reason");
      void run(async()=>{await api(endpoint+"/"+editing.id+"/anonymize","POST",{version:editing.version,reason},crypto.randomUUID());edit(null);show(false);refresh(v=>v+1);});
    }}><label>{t("Lý do ẩn danh")}<input name="reason" required minLength={3} maxLength={250}/></label><button disabled={busy}>{t("Xác nhận ẩn danh")}</button></form></details>}
  </section>;
}
