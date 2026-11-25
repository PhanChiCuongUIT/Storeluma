import React, {useEffect, useRef, useState} from "react";
import {t, locale} from "./i18n";

type Customer = {id:string; name:string; phone?:string; email?:string; note:string; marketing_consent:boolean; status:string; version:number};
type History = {id:string; code:string; status:string; payable_vnd:string; created_at:string};
type Props = {
  path:string; site:string; role:string;
  api:(path:string,method?:string,body?:unknown,key?:string)=>Promise<any>;
  select?:(id:string,name:string)=>void;
};

// A changed search or customer starts a new request sequence. A late page
// from the old sequence must never append to the currently visible results.
function usePages<T>(api:Props["api"], url:string, revision:number, delay=0) {
  const client=useRef(api);
  client.current=api;
  const active=useRef(0), inFlight=useRef(false);
  const [items,setItems]=useState<T[]>([]),[cursor,setCursor]=useState<string|null>(null);
  const [total,setTotal]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  async function load(sequence:number, after:string|null) {
    if(sequence!==active.current || inFlight.current)return;
    inFlight.current=true;setLoading(true);setError("");
    try {
      const result=await client.current(url+(after?"&cursor="+encodeURIComponent(after):""));
      if(sequence!==active.current)return;
      setItems(previous=>after?[...previous,...result.items]:result.items);
      setCursor(result.nextCursor);setTotal(result.totalSpentVnd??null);
    } catch(e) {
      if(sequence===active.current)setError((e as Error).message);
    } finally {
      if(sequence===active.current){inFlight.current=false;setLoading(false);}
    }
  }
  useEffect(()=>{
    const sequence=++active.current;
    inFlight.current=false;setItems([]);setCursor(null);setTotal(null);setLoading(true);setError("");
    const timer=setTimeout(()=>void load(sequence,null),delay);
    return ()=>{active.current++;clearTimeout(timer);};
  },[url,revision,delay]);
  return {items,cursor,total,loading,error,load:()=>void load(active.current,cursor)};
}

const orderStatus:Record<string,string>={DRAFT:"Đơn nháp",PENDING:"Chờ thu tiền",COMMITTING:"Đang xuất kho",COMPLETED:"Hoàn tất",CANCELLED:"Đã hủy",REVIEW:"Đang đối chiếu"};
function PurchaseHistory({api,url,name}:{api:Props["api"];url:string;name:string}) {
  const history=usePages<History>(api,url,0);
  return <section className="customer-history">
    <h3>{t("Lịch sử mua")} · {name}</h3>
    {history.total!==null&&<p>{t("Chi tiêu sau hoàn trả")} · <strong>{BigInt(history.total).toLocaleString(locale())} ₫</strong></p>}
    <ul className="customer-list">{history.items.map(order=><li key={order.id}>
      <div><strong>{order.code}</strong><small>{new Date(order.created_at).toLocaleDateString(locale())} · {t(orderStatus[order.status]??order.status)}</small></div>
      <span>{BigInt(order.payable_vnd).toLocaleString(locale())} ₫</span>
    </li>)}</ul>
    {history.loading&&<p role="status">{t("Đang tải…")}</p>}
    {history.error&&<p className="alert" role="alert">{t(history.error)}</p>}
    {!history.loading&&!history.error&&!history.items.length&&<p>{t("Chưa có đơn tại địa điểm này.")}</p>}
    {(history.cursor||history.error)&&<button type="button" className="button secondary small" disabled={history.loading} onClick={history.load}>
      {history.error?t("Thử lại"):t("Xem thêm đơn")}</button>}
  </section>;
}
export function CustomerPanel({path,site,role,api,select}:Props) {
  const [q,search]=useState("");
  const [editing,edit]=useState<Customer|null>(null),[form,show]=useState(false),[history,setHistory]=useState<Customer|null>(null);
  const [error,fail]=useState(""),[busy,setBusy]=useState(false),[revision,refresh]=useState(0);
  const [duplicates,setDuplicates]=useState<Customer[]>([]),[phone,setPhone]=useState("");
  const endpoint=path+"/customers";
  const listUrl=endpoint+"?active="+Boolean(select)+"&q="+encodeURIComponent(q);
  const directory=usePages<Customer>(api,listUrl,revision,180);
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
    <label>{t("Tìm theo tên hoặc điện thoại")}<input type="search" value={q} onChange={e=>{search(e.target.value);setHistory(null);}}/></label>
    <ul className="customer-list">{directory.items.map(c=><li key={c.id}><div><strong>{c.name}</strong>
      {c.phone&&<small>{c.phone}</small>}{c.status==="INACTIVE"&&<small>{t("Ngừng hoạt động")}</small>}</div><div className="customer-actions">
      {select ? <button type="button" className="button secondary small" onClick={()=>select(c.id,c.name)}>{t("Chọn")}</button> : <>
        <button type="button" className="button secondary small" disabled={busy||!site} onClick={()=>{show(false);setHistory(c);}}>{t("Lịch sử mua")}</button>
        {role!=="ACCOUNTANT"&&<button type="button" className="button secondary small" onClick={()=>start(c)}>{t("Chỉnh sửa")}</button>}
      </>}</div></li>)}</ul>
    {directory.loading&&<p role="status">{t("Đang tải…")}</p>}
    {directory.error&&<p className="alert" role="alert">{t(directory.error)}</p>}
    {!directory.loading&&!directory.error&&!directory.items.length&&<p role="status">{q?t("Không tìm thấy khách hàng."):t("Chưa có khách hàng.")}</p>}
    {(directory.cursor||directory.error)&&<button type="button" className="button secondary small" disabled={directory.loading} onClick={directory.load}>{directory.error?t("Thử lại"):t("Xem thêm")}</button>}
    {history&&<PurchaseHistory key={history.id} name={history.name} api={api} url={endpoint+"/"+history.id+"/history?siteId="+site+"&limit=10"}/>}
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
