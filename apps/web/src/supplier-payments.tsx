import React,{useState,useEffect} from "react";
import {t} from "./i18n";
import {useCommand,vnd,when} from "./after-sales";
type Row=Record<string,any>;
type Props={path:string;site:string;supplier:string;debts:Row[];after:()=>void;api:(path:string,method?:string,body?:unknown,key?:string)=>Promise<any>};
export function SupplierPayments({path,site,supplier,debts,api,after}:Props){
  const [accounts,setAccounts]=useState<Row[]>([]),[account,setAccount]=useState(""),[shifts,setShifts]=useState<Row[]>([]);
  const [paid,setPaid]=useState<Row[]>([]),[reverse,setReverse]=useState<Row|null>(null),[revision,refresh]=useState(0);
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  const action=useCommand(api,path);
  const selected=accounts.find(a=>a.id===account);
  const current=shifts.find(s=>s.status==="OPEN" && s.register_id===selected?.register_id);
  useEffect(()=>{
    let live=true;
    async function load(){
      const [list,registers]=await Promise.all([api(path+"/cash-accounts?siteId="+site),api(path+"/shifts?siteId="+site)]);
      let cursor=null;const records:Row[]=[];
      do{const page=await api(path+"/supplier-payments?siteId="+site+"&supplierId="+supplier+(cursor?"&cursor="+cursor:""));records.push(...page.items);cursor=page.nextCursor;}while(cursor);
      if(live){setAccounts(list);setAccount(old=>list.some((a:Row)=>a.id===old)?old:list[0]?.id??"");setPaid(records);setShifts(registers.activeShift?[registers.activeShift,...registers.items]:registers.items);setError("");}
    }
    void load().catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[path,site,supplier,revision]);
  const [entries,setEntries]=useState<Row[]>([]),[entryId,setEntryId]=useState("");
  useEffect(()=>{let live=true;setEntries([]);setEntryId("");if(selected&&selected.kind!=="DRAWER"){const load=async()=>{const all=[];let cursor=null;do{const d=await api(path+"/cash-accounts/"+account+"/entries?siteId="+site+(cursor?"&cursor="+cursor:""));all.push(...d.items);cursor=d.nextCursor;}while(cursor);if(live)setEntries(all);};void load().catch(e=>{if(live)setError(e.message);});}return()=>{live=false;};},[account,selected?.kind,path,site,revision]);
  const ready=selected && (selected.kind!=="DRAWER" || current);
  return <section className="customer-panel"><h3>{t("Thanh toán nhà cung cấp")}</h3>
    {(error||action.error)&&<p role="alert">{t(error||action.error)}</p>}{notice&&<p role="status">{notice}</p>}
    <details><summary>{t("Thêm tài khoản tiền")}</summary><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const form=e.currentTarget;
      void action.run(async()=>{const a=await action.command("/cash-accounts",{siteId:site,kind:f.get("kind"),code:f.get("code"),name:f.get("name")});setAccount(a.id);refresh(v=>v+1);form.reset();});}}>
      <label>{t("Loại tài khoản")}<select name="kind"><option value="CASH">{t("Tiền mặt ngoài quầy")}</option><option value="BANK">{t("Ngân hàng")}</option></select></label>
      <label>{t("Mã tài khoản")}<input name="code" required pattern="[A-Z0-9_\-]{1,32}"/></label>
      <label>{t("Tên tài khoản")}<input name="name" required maxLength={120}/></label><button className="button secondary" disabled={action.busy}>{t("Tạo tài khoản tiền")}</button></form></details>
    <label>{t("Tài khoản tiền")}<select value={account} onChange={e=>setAccount(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    {selected?.kind==="DRAWER"&&!current&&<p>{t("Mở ca hoặc chọn tài khoản ngoài quầy.")}</p>}
    {selected&&selected.kind!=="DRAWER"&&<details><summary>{t("Thu chi ngoài quầy")}</summary><form key={account+revision} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void action.run(async()=>{
      await action.command("/cash-accounts/"+account+"/entries",{siteId:site,kind:entryId?"REVERSAL":f.get("kind"),amountVnd:entryId?undefined:f.get("amount"),reversalOf:entryId||undefined,reason:f.get("reason")});setEntryId("");refresh(v=>v+1);});}}>
      <label>{t("Chứng từ gốc")}<select value={entryId} onChange={e=>setEntryId(e.target.value)}><option value="">{t("Lập phiếu mới")}</option>{entries.filter(v=>v.kind!=="REVERSAL"&&!entries.some(e=>e.reversal_of===v.id)).map(v=><option value={v.id} key={v.id}>{when(v.created_at)} · {vnd(v.amount_vnd)} · {v.reason}</option>)}</select></label>
      {!entryId&&<><label>{t("Loại phiếu")}<select name="kind"><option value="IN">{t("Thu")}</option><option value="OUT">{t("Chi")}</option></select></label><label>{t("Số tiền")}<input required name="amount" pattern="[0-9]+" inputMode="numeric"/></label></>}
      <label>{t("Lý do")}<input required name="reason" minLength={3} maxLength={500}/></label><button disabled={action.busy}>{entryId?t("Ghi chứng từ đảo"):t("Ghi sổ")}</button></form></details>}
    <form key={(reverse?.id??"pay")+":"+revision} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);
      void action.run(async()=>{
        if(reverse){await action.command("/supplier-payments/"+reverse.id+"/reverse",{version:reverse.version,targetAccountId:account,targetShiftId:current?.id,reason:data.get("reason")});}
        else{
          const allocations=debts.map(d=>({payableId:d.id,amountVnd:String(data.get(d.id)??"").trim()})).filter(a=>/^\d+$/.test(a.amountVnd)&&BigInt(a.amountVnd)>0n);
          if(!allocations.length)throw new Error(t("Chọn ít nhất một khoản phải trả."));
          const amountVnd=allocations.reduce((n,a)=>n+BigInt(a.amountVnd),0n).toString();
          await action.command("/supplier-payments",{siteId:site,supplierId:supplier,accountId:account,shiftId:current?.id,allocations,amountVnd,reason:data.get("reason"),reference:data.get("reference"),cashPaid:true});
        }
        setNotice(t("Đã ghi sổ."));setReverse(null);refresh(v=>v+1);after();
      });}}>
      {reverse?<p>{t("Đảo khoản đã trả")} · {vnd(reverse.amount_vnd)} <button type="button" onClick={()=>setReverse(null)}>{t("Hủy")}</button></p>:<>
        {debts.filter(d=>BigInt(d.outstanding_vnd)>0n).map(d=><label key={d.id}>{t("Phân bổ cho phiếu nhập")} · {when(d.posted_at)} · {vnd(d.outstanding_vnd)}<input name={d.id} inputMode="numeric" pattern="[0-9]+" placeholder="0"/></label>)}
        <label>{t("Số tham chiếu")}<input name="reference" maxLength={120}/></label></>}
      <label>{t("Lý do")}<input required minLength={3} maxLength={500} name="reason"/></label>
      <label><input type="checkbox" required/>{t("Đã đối chiếu số tiền thực tế")}</label>
      <button className="button primary" disabled={!ready||action.busy}>{reverse?t("Ghi chứng từ đảo"):t("Ghi thanh toán")}</button>
    </form>
    {paid.map(p=><p key={p.id}>{when(p.posted_at)} · {vnd(p.amount_vnd)} · {p.reason} {p.status==="REVERSED"?t("Đã đảo"):p.reversal_of?t("Chứng từ đảo"):<button className="button secondary small" onClick={()=>setReverse(p)}>{t("Đảo khoản đã trả")}</button>}</p>)}
  </section>;
}
