'use client';
import OperationNotice from '../admin/OperationNotice';
import {useState,type FormEvent} from 'react';
import {api} from '@/lib/api-client';
import {kstDateTime} from '@/lib/kst-time';
import type {PointsState,TutorialState} from '@/server/engagement/service';

const REASON:Record<string,string>={attendance:'출석',tutorial:'시작 가이드'};
export default function EngagementPanel({initialPoints,initialTutorial,floating=false}:{initialPoints:PointsState;initialTutorial:TutorialState;floating?:boolean}){
 const [wallet,setWallet]=useState(initialPoints),[guide,setGuide]=useState(initialTutorial);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function reload(page=wallet.pagination.page){
  const [p,g]=await Promise.all([api<PointsState>(`/api/points?page=${page}&pageSize=10`),api<TutorialState>('/api/tutorial')]);
  setWallet(p);setGuide(g);
 }
 async function run(action:()=>Promise<void>){
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{await action();}catch(e){setError(e instanceof Error?e.message:'요청을 처리하지 못했습니다.');}finally{setBusy(false);}
 }
 async function claim(path:string,body?:unknown){
  await run(async()=>{const result=await api<{awarded:number}>(path,{method:'POST',body});setNotice(result.awarded?`${result.awarded}P를 받았습니다.`:'이미 수령한 보상입니다.');await reload(1);});
 }
 async function saveTopic(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=new FormData(e.currentTarget);
  await run(async()=>{await api('/api/tutorial/sub-topic',{method:'PUT',body:{subTopic:form.get('subTopic'),version:guide.subTopic.version}});await reload();setNotice('서브 주제를 저장했습니다.');});
 }
 const cooling=guide.subTopic.nextChangeAt!==null&&guide.subTopic.nextChangeAt>guide.now;
 const content=<section id="points" className="panel account-card engagement-panel" aria-label="포인트와 시작 가이드">
  <div className="engagement-heading"><h2>포인트와 출석</h2><button className="button secondary" disabled={busy} onClick={()=>void run(()=>reload())}>새로고침</button></div>
  <p className="engagement-balance">{wallet.balance.toLocaleString('ko-KR')}<span>P</span></p>
  <p className="muted">매일 5P · 연속 7일마다 15P 추가 · 한국 시간 자정 기준</p>
  <p>{wallet.attendance.today} · 연속 {wallet.attendance.streak}일</p>
  <button className="button" disabled={busy||wallet.attendance.checkedIn} onClick={()=>void claim('/api/attendance')}>{wallet.attendance.checkedIn?'오늘 출석 완료':'오늘 출석하고 5P 받기'}</button>
  <OperationNotice message={notice}/>{error&&<p role="alert" className="account-error">{error}</p>}
  <h3>시작 가이드 · {guide.claimedPoints} / {guide.totalPoints}P</h3>
  <ol className="engagement-steps">{guide.steps.map(s=><li key={s.key}><div><a href={s.href}>{s.title}</a><strong>{s.points}P</strong></div>{s.lockedReason&&<p className="muted">{s.lockedReason}</p>}<button className="button secondary" disabled={busy||s.done||!s.eligible} onClick={()=>void claim('/api/tutorial/finish',{step:s.key})}>{s.done?'수령 완료':`${s.points}P 받기`}</button></li>)}</ol>
  <form className="account-form" key={guide.subTopic.version} onSubmit={saveTopic}>
   <label>내 서브 주제<input className="field" name="subTopic" defaultValue={guide.subTopic.subTopic} maxLength={50} required disabled={busy||cooling} placeholder="예: 여행"/></label>
   <p className="muted">첫 저장 후 7일 동안 수정·삭제할 수 없습니다.{cooling&&` 변경 가능: ${kstDateTime(guide.subTopic.nextChangeAt!)}`}</p>
   <div className="account-actions"><button className="button secondary" disabled={busy||cooling}>서브 주제 저장</button>{guide.subTopic.subTopic&&<button type="button" className="button secondary" disabled={busy||cooling} onClick={()=>void run(async()=>{await api('/api/tutorial/sub-topic',{method:'DELETE',body:{version:guide.subTopic.version}});await reload();setNotice('서브 주제를 삭제했습니다.');})}>서브 주제 삭제</button>}</div>
  </form>
  <h3>포인트 내역</h3>{wallet.entries.length?<ul className="engagement-ledger">{wallet.entries.map(e=><li key={e.id}><span>{REASON[e.reason]??e.reason} · {kstDateTime(e.createdAt)}</span><strong>+{e.delta}P</strong></li>)}</ul>:<p className="muted">아직 받은 포인트가 없습니다.</p>}
  <div className="account-actions"><button className="button secondary" disabled={busy||wallet.pagination.page<=1} onClick={()=>void run(()=>reload(wallet.pagination.page-1))}>이전 내역</button><span>{wallet.pagination.page} / {Math.max(1,Math.ceil(wallet.pagination.total/wallet.pagination.pageSize))}</span><button className="button secondary" disabled={busy||wallet.pagination.page*wallet.pagination.pageSize>=wallet.pagination.total} onClick={()=>void run(()=>reload(wallet.pagination.page+1))}>다음 내역</button></div>
 </section>;
 return floating?<details className="engagement-drawer"><summary>포인트·출석 · {wallet.balance.toLocaleString('ko-KR')}P</summary>{content}</details>:content;
}
