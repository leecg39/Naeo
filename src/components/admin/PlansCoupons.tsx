'use client';
import {kstDateTime} from '@/lib/kst-time';
import {useState,type FormEvent} from 'react';
import {api,apiResponse,type PageResult} from '@/lib/api-client';
import type {Plan} from '@/server/billing/plans';
import type {Coupon} from '@/server/billing/coupons';

type PlanForm={code:string;name:string;description:string;price:string;monthlyTokens:string;trialDays:string;status:Plan['status'];position:string};
const planForm=(p?:Plan):PlanForm=>({code:p?.code??'',name:p?.name??'',description:p?.description??'',price:String(p?.price??0),monthlyTokens:String(p?.monthlyTokens??0),trialDays:String(p?.trialDays??0),status:p?.status??'active',position:String(p?.position??0)});
const KIND:Record<Coupon['kind'],string>={tokens:'토큰 지급',percent_off:'% 할인',amount_off:'원 할인'};
const kst=(ms:number)=>new Date(ms+9*3600_000).toISOString().slice(0,16);
const iso=(local:string)=>`${local}:00+09:00`;
const fmt=(ms:number)=>kstDateTime(ms,{seconds:true});

/** now: 새 쿠폰 기본 기간(지금~30일)의 기준 시각, 서버가 넘긴다. */
export default function PlansCoupons({initialPlans,initialCoupons,now}:{initialPlans:Plan[];initialCoupons:PageResult<Coupon>;now:number}){
 const [plans,setPlans]=useState(initialPlans),[coupons,setCoupons]=useState(initialCoupons);
 const [editing,setEditing]=useState<Plan|null|'new'>(null),[form,setForm]=useState<PlanForm>(planForm());
 const [coupon,setCoupon]=useState({code:'',kind:'tokens' as Coupon['kind'],value:'10',planCode:'',maxRedemptions:'',startsAt:kst(now),endsAt:kst(now+30*86_400_000),note:''});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function run(action:()=>Promise<string>){setBusy(true);setError('');setNotice('');try{setNotice(await action());}catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');}finally{setBusy(false);}}
 const loadPlans=async()=>setPlans(await api<Plan[]>('/api/admin/plans'));
 const loadCoupons=async()=>setCoupons(await apiResponse<PageResult<Coupon>>('/api/admin/coupons?pageSize=100'));
 const set=<K extends keyof PlanForm>(k:K,v:PlanForm[K])=>setForm(f=>({...f,[k]:v}));
 const open=(p:Plan|'new')=>{setEditing(p);setForm(planForm(p==='new'?undefined:p));};
 const savePlan=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  const body={code:form.code,name:form.name,description:form.description,price:Number(form.price),monthlyTokens:Number(form.monthlyTokens),trialDays:Number(form.trialDays),status:form.status,position:Number(form.position)};
  if(editing&&editing!=='new')await api(`/api/admin/plans/${editing.id}`,{method:'PATCH',body:{...body,version:editing.version}});else await api('/api/admin/plans',{method:'POST',body});
  setEditing(null);await loadPlans();return '요금제를 저장했습니다. /pricing에 바로 반영됩니다.';
 });};
 const removePlan=(p:Plan)=>void run(async()=>{await api(`/api/admin/plans/${p.id}`,{method:'DELETE',body:{version:p.version}});setEditing(null);await loadPlans();return '요금제를 삭제했습니다.';});
 const createCoupon=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  await api('/api/admin/coupons',{method:'POST',body:{code:coupon.code,kind:coupon.kind,value:Number(coupon.value),planCode:coupon.planCode||null,maxRedemptions:coupon.maxRedemptions?Number(coupon.maxRedemptions):null,startsAt:iso(coupon.startsAt),endsAt:iso(coupon.endsAt),note:coupon.note}});
  setCoupon(c=>({...c,code:'',note:''}));await loadCoupons();return '쿠폰을 만들었습니다.';
 });};
 const toggleCoupon=(c:Coupon)=>void run(async()=>{await api(`/api/admin/coupons/${c.id}`,{method:'PATCH',body:{status:c.status==='active'?'disabled':'active',version:c.version}});await loadCoupons();return c.status==='active'?'쿠폰을 중지했습니다.':'쿠폰을 다시 켰습니다.';});
 return <div className="settings-sections">
  <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>
  <section className="panel account-card" aria-label="요금제">
   <h2>요금제</h2>
   <div className="responsive-table"><table className="data-table"><caption className="sr-only">요금제 목록</caption>
    <thead><tr><th>이름(코드)</th><th>가격</th><th>30일 토큰</th><th>체험</th><th>상태</th><th>관리</th></tr></thead>
    <tbody>{plans.map(p=><tr key={p.id}><td><strong>{p.name}</strong> <span className="muted">({p.code})</span></td><td>₩{p.price.toLocaleString('ko-KR')}</td><td>{p.monthlyTokens}</td><td>{p.trialDays?`${p.trialDays}일`:'-'}</td><td>{p.status==='active'?'판매':'숨김'}</td>
     <td><button className="button secondary" type="button" disabled={busy} onClick={()=>open(p)}>편집<span className="sr-only"> {p.name}</span></button></td></tr>)}</tbody></table></div>
   <button className="button secondary" type="button" disabled={busy} onClick={()=>open('new')}>새 요금제</button>
   {editing&&<form className="account-form" onSubmit={savePlan} aria-label={editing==='new'?'새 요금제':'요금제 편집'}>
    <label>코드(영문 소문자)<input className="field" value={form.code} onChange={e=>set('code',e.target.value)} required maxLength={30} disabled={busy}/></label>
    <label>이름<input className="field" value={form.name} onChange={e=>set('name',e.target.value)} required maxLength={40} disabled={busy}/></label>
    <label>설명<input className="field" value={form.description} onChange={e=>set('description',e.target.value)} maxLength={300} disabled={busy}/></label>
    <label>가격(원, 30일)<input className="field" type="number" min={0} value={form.price} onChange={e=>set('price',e.target.value)} required disabled={busy}/></label>
    <label>30일마다 지급 토큰<input className="field" type="number" min={0} value={form.monthlyTokens} onChange={e=>set('monthlyTokens',e.target.value)} disabled={busy}/></label>
    <label>무료 체험 일수(0이면 없음)<input className="field" type="number" min={0} max={30} value={form.trialDays} onChange={e=>set('trialDays',e.target.value)} disabled={busy}/></label>
    <label>상태<select className="field" value={form.status} onChange={e=>set('status',e.target.value as Plan['status'])} disabled={busy}><option value="active">판매</option><option value="hidden">숨김</option></select></label>
    <label>순서<input className="field" type="number" value={form.position} onChange={e=>set('position',e.target.value)} disabled={busy}/></label>
    <p className="muted">가격을 바꿔도 이미 결제한 주문 금액은 바뀌지 않아요.</p>
    <div className="account-actions"><button className="button" type="submit" disabled={busy}>저장</button>{editing!=='new'&&<button className="button secondary" type="button" disabled={busy} onClick={()=>removePlan(editing)}>삭제</button>}<button className="button secondary" type="button" disabled={busy} onClick={()=>setEditing(null)}>닫기</button></div>
   </form>}
  </section>
  <section className="panel account-card" aria-label="쿠폰">
   <h2>쿠폰</h2>
   <form className="admin-filters" onSubmit={createCoupon} aria-label="새 쿠폰">
    <label>코드<input className="field" value={coupon.code} onChange={e=>setCoupon(c=>({...c,code:e.target.value}))} required maxLength={32} disabled={busy}/></label>
    <label>종류<select className="field" value={coupon.kind} onChange={e=>setCoupon(c=>({...c,kind:e.target.value as Coupon['kind']}))} disabled={busy}><option value="tokens">토큰 지급</option><option value="percent_off">% 할인</option><option value="amount_off">원 할인</option></select></label>
    <label>값<input className="field" type="number" min={1} value={coupon.value} onChange={e=>setCoupon(c=>({...c,value:e.target.value}))} required disabled={busy}/></label>
    <label>요금제 코드(선택)<input className="field" value={coupon.planCode} onChange={e=>setCoupon(c=>({...c,planCode:e.target.value}))} maxLength={30} disabled={busy}/></label>
    <label>총 사용 한도(비우면 무제한)<input className="field" type="number" min={1} value={coupon.maxRedemptions} onChange={e=>setCoupon(c=>({...c,maxRedemptions:e.target.value}))} disabled={busy}/></label>
    <label>시작(한국 시간)<input className="field" type="datetime-local" value={coupon.startsAt} onChange={e=>setCoupon(c=>({...c,startsAt:e.target.value}))} required disabled={busy}/></label>
    <label>종료(한국 시간)<input className="field" type="datetime-local" value={coupon.endsAt} onChange={e=>setCoupon(c=>({...c,endsAt:e.target.value}))} required disabled={busy}/></label>
    <label>메모<input className="field" value={coupon.note} onChange={e=>setCoupon(c=>({...c,note:e.target.value}))} maxLength={200} disabled={busy}/></label>
    <button className="button" type="submit" disabled={busy}>쿠폰 만들기</button>
   </form>
   <div className="responsive-table"><table className="data-table"><caption className="sr-only">쿠폰 목록</caption>
    <thead><tr><th>코드</th><th>혜택</th><th>사용</th><th>기간</th><th>상태</th><th>관리</th></tr></thead>
    <tbody>{coupons.data.map(c=><tr key={c.id}><td><strong>{c.code}</strong>{c.note&&<span className="muted"> · {c.note}</span>}</td><td>{c.value}{KIND[c.kind]==='토큰 지급'?'토큰':KIND[c.kind]}{c.planCode?` (${c.planCode})`:''}</td><td>{c.redemptions}{c.maxRedemptions?` / ${c.maxRedemptions}`:''}</td><td>{fmt(c.startsAt)} ~ {fmt(c.endsAt)}</td><td>{c.status==='active'?'사용 가능':'중지'}</td>
     <td><button className="button secondary" type="button" disabled={busy} onClick={()=>toggleCoupon(c)}>{c.status==='active'?'중지':'다시 켜기'}<span className="sr-only"> {c.code}</span></button></td></tr>)}</tbody></table>
    {!coupons.data.length&&<p className="empty-state">쿠폰이 없습니다.</p>}</div>
  </section>
 </div>;
}
