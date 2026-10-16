'use client';
import OperationNotice from '../admin/OperationNotice';
import {useEffect,useState,type FormEvent} from 'react';
import {kstDateTime} from '@/lib/kst-time';
import {api,ApiError} from '@/lib/api-client';
import type {PersonalExport} from '@/server/privacy/personal-export';
const labels={queued:'준비 대기',running:'자료를 모으는 중',succeeded:'내려받기 가능',failed:'준비 실패'};
export default function PersonalDataExport({initial,hasPassword}:{initial:PersonalExport[];hasPassword:boolean}){
 const [jobs,setJobs]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const active=jobs.some(j=>j.state==='queued'||j.state==='running');
 useEffect(()=>{
  let stopped=false,timer:ReturnType<typeof setTimeout>;
  const refresh=async()=>{try{const data=await api<PersonalExport[]>('/api/auth/data-exports');if(!stopped)setJobs(data);}catch(e){if(!stopped)setError(e instanceof Error?e.message:'상태를 불러오지 못했습니다.');if(e instanceof ApiError&&e.status===401)return;}if(!stopped)timer=setTimeout(refresh,active?3000:30000);};
  timer=setTimeout(refresh,active?3000:30000);
  return()=>{stopped=true;clearTimeout(timer);};
 },[active]);
 async function request(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,fields=new FormData(form);setBusy(true);setError('');setNotice('');
  try{await api('/api/auth/data-exports',{method:'POST',body:hasPassword?{currentPassword:fields.get('currentPassword')}:{}});form.reset();setJobs(await api<PersonalExport[]>('/api/auth/data-exports'));setNotice('내보내기를 요청했습니다. 준비가 끝나면 아래에서 내려받을 수 있습니다.');}
  catch(e){setError(e instanceof Error?e.message:'자료를 요청하지 못했습니다.');}finally{setBusy(false);}
 }
 async function remove(id:string){setBusy(true);setError('');try{await api(`/api/auth/data-exports/${id}`,{method:'DELETE'});setJobs(await api<PersonalExport[]>('/api/auth/data-exports'));setNotice('요청을 삭제했습니다.');}catch(e){setError(e instanceof Error?e.message:'삭제하지 못했습니다.');}finally{setBusy(false);}}
 return <section className="panel account-card"><h2>내 데이터 내려받기</h2>
  <p className="muted">계정 정보, 글과 수정 이력, 블로그 진단, 활동·결제·문의 기록과 보관 중인 사진·제작 파일을 TAR 파일로 내려받습니다. 압축을 풀면 항목별 JSON Lines와 첨부 파일을 볼 수 있습니다.</p>
  <p className="muted">요청 후 최대 1시간 동안 이 로그인에서만 받을 수 있습니다. 로그아웃·비밀번호 변경·탈퇴 시 요청도 삭제됩니다. 파일에는 개인정보가 포함되므로 안전한 곳에 보관해주세요.</p>
  <form method="post" className="account-form" onSubmit={request}>
   {hasPassword?<label>본인 확인 비밀번호<input type="password" name="currentPassword" className="field" autoComplete="current-password" maxLength={128} required disabled={busy||active}/></label>:<p>소셜 계정으로 로그인한 뒤 10분 안에 요청해주세요. 시간이 지났다면 다시 로그인해야 합니다.</p>}
   <button className="button" type="submit" disabled={busy||active}>{active?'자료 준비 중':'내 데이터 내보내기 요청'}</button>
  </form>
  <div aria-live="polite"><OperationNotice message={notice}/>{error&&<p role="alert" className="account-error">{error}</p>}</div>
  <ul className="account-blog-list">{jobs.map(j=><li key={j.id}><div><strong>{labels[j.state]}</strong><small>요청: {kstDateTime(j.createdAt)} KST</small><small>받을 수 있는 시간: {kstDateTime(j.expiresAt)} KST</small>{j.error&&<p role="alert">{j.error}</p>}{j.state==='queued'&&<p className="muted">대기가 계속되면 잠시 후 새로고침하거나 고객 지원에 문의해주세요.</p>}{j.fileSize!==null&&<small>{(j.fileSize/1024/1024).toFixed(1)} MB</small>}</div><div className="account-actions">{j.state==='succeeded'&&<a className="button" href={`/api/auth/data-exports/${j.id}/download`} download>파일 내려받기</a>}<button type="button" className="button secondary" disabled={busy} onClick={()=>void remove(j.id)}>{j.state==='queued'||j.state==='running'?'요청 취소':'요청 삭제'}</button></div></li>)}</ul>
  <button type="button" className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);try{setJobs(await api<PersonalExport[]>('/api/auth/data-exports'));setError('');}catch(e){setError(e instanceof Error?e.message:'상태를 불러오지 못했습니다.');}finally{setBusy(false);}}}>내보내기 상태 새로고침</button>
 </section>;
}
