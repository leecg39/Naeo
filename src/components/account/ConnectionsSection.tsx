'use client';
import OperationNotice from '../admin/OperationNotice';
import {kstDate} from '@/lib/kst-time';
import {useState,type FormEvent} from 'react';
import {api,ApiError} from '@/lib/api-client';
import type {Connection} from '@/server/oauth/oauth';
import type {OAuthProviderName} from '@/server/oauth/providers';
import {OAUTH_ERRORS} from './SocialLogin';

export type ConnectionsState={connections:Connection[];hasPassword:boolean;configured:Record<OAuthProviderName,boolean>};
const NAME:Record<OAuthProviderName,string>={google:'Google',naver:'네이버'};
const day=(ms:number)=>kstDate(ms);

export default function ConnectionsSection({initial,linked,error:initialError}:{initial:ConnectionsState;linked?:string;error?:string}){
 const [state,setState]=useState(initial),[password,setPassword]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(initialError?OAUTH_ERRORS[initialError]??'연결하지 못했어요.':'');
 const [notice,setNotice]=useState(linked&&linked in NAME?`${NAME[linked as OAuthProviderName]} 계정을 연결했어요.`:'');
 async function run(action:()=>Promise<string>){setBusy(true);setError('');setNotice('');try{const m=await action();setState(await api<ConnectionsState>('/api/account/oauth'));setNotice(m);}catch(e){setError(e instanceof ApiError||e instanceof Error?e.message:'처리하지 못했어요.');}finally{setBusy(false);}}
 const unlink=(p:OAuthProviderName)=>void run(async()=>{await api(`/api/account/oauth/${p}`,{method:'DELETE'});return `${NAME[p]} 연결을 해제했어요.`;});
 const setInitial=(e:FormEvent)=>{e.preventDefault();void run(async()=>{await api('/api/account/password/initial',{method:'POST',body:{newPassword:password}});setPassword('');return '비밀번호를 설정했어요. 이제 이메일로도 로그인할 수 있어요.';});};
 return <section className="panel account-card" id="connections" aria-label="로그인 연결">
  <h2>로그인 연결</h2>
  <div aria-live="polite"><OperationNotice message={notice}/>{error&&<p role="alert" className="account-error">{error}</p>}</div>
  {(Object.keys(NAME) as OAuthProviderName[]).map(p=>{const c=state.connections.find(x=>x.provider===p);return <div key={p} className="account-actions" data-connection={p} style={{justifyContent:'space-between'}}>
   <span><strong>{NAME[p]}</strong> {c?<span className="muted">· {c.email||'이메일 없음'} · {day(c.createdAt)} 연결</span>:<span className="muted">· 연결 안 됨</span>}</span>
   {c?<button className="button secondary" type="button" disabled={busy} onClick={()=>unlink(p)}>연결 해제<span className="sr-only"> {NAME[p]}</span></button>
    :state.configured[p]?<a className="button secondary" href={`/api/auth/oauth/${p}/start?intent=link&next=%2Fdashboard%2Fsettings`}>연결하기<span className="sr-only"> {NAME[p]}</span></a>
    :<button className="button secondary" type="button" disabled>미설정</button>}
  </div>;})}
  {!state.hasPassword&&<form method="post" className="account-form" onSubmit={setInitial} aria-label="비밀번호 설정">
   <p className="muted">간편 로그인으로 가입해 비밀번호가 없어요. 연결 해제·탈퇴에는 비밀번호가 필요해요. 보안을 위해 로그인한 지 10분 안에만 설정할 수 있어요.</p>
   <label>새 비밀번호(10자 이상)<input className="field" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} required disabled={busy}/></label>
   <div className="account-actions"><button className="button" type="submit" disabled={busy}>비밀번호 설정</button></div>
  </form>}
 </section>;
}
