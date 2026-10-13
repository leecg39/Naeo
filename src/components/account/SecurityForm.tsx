'use client';
import {useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {api,ApiError} from '@/lib/api-client';
import type {User} from '@/server/auth';
import type {SessionInfo} from '@/server/account-security';

export default function SecurityForm({user,initialSessions}:{user:User;initialSessions:SessionInfo[]}) {
 const router=useRouter(),[sessions,setSessions]=useState(initialSessions),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[deleting,setDeleting]=useState(false),[key,setKey]=useState(0);
 const signedOut=()=>{router.replace('/login');router.refresh();};
 async function run(action:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'요청을 처리하지 못했습니다.');if(e instanceof ApiError&&e.status===401)signedOut();}finally{setBusy(false);}}
 async function change(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);if(f.get('newPassword')!==f.get('confirmPassword')){setError('새 비밀번호가 일치하지 않습니다.');return;}await run(async()=>{await api('/api/auth/password',{method:'PATCH',body:{currentPassword:f.get('currentPassword'),newPassword:f.get('newPassword')}});setSessions(await api<SessionInfo[]>('/api/auth/sessions'));setKey(k=>k+1);setNotice('비밀번호를 변경하고 다른 기기와 외부 앱의 연결을 종료했습니다. 외부 앱은 다시 연결해주세요.');router.refresh();});}
 async function remove(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);await run(async()=>{const {user:latest}=await api<{user:User}>('/api/auth/me');await api('/api/auth/account',{method:'DELETE',body:{currentPassword:f.get('currentPassword'),confirmEmail:f.get('confirmEmail'),version:latest.version}});signedOut();});}
 return <section className="panel account-card"><h2>계정 보안</h2><div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>
  <h3>비밀번호 변경</h3><p className="muted">변경하면 다른 기기의 로그인과 연결된 외부 앱의 접근 권한이 종료됩니다.</p><form key={key} className="account-form" onSubmit={change}>
   <label>현재 비밀번호<input name="currentPassword" type="password" className="field" autoComplete="current-password" required maxLength={128} disabled={busy}/></label>
   <label>새 비밀번호<input name="newPassword" type="password" className="field" autoComplete="new-password" required minLength={10} maxLength={128} disabled={busy}/></label>
   <label>새 비밀번호 확인<input name="confirmPassword" type="password" className="field" autoComplete="new-password" required minLength={10} maxLength={128} disabled={busy}/></label>
   <button type="submit" className="button" disabled={busy}>비밀번호 변경</button>
  </form>
  <h3>로그인한 기기</h3><ul className="account-blog-list">{sessions.map(session=><li key={session.id}><div><strong>{session.current?'현재 로그인':'다른 로그인'}</strong><small>로그인: <time dateTime={new Date(session.createdAt).toISOString()}>{new Date(session.createdAt).toISOString().slice(0,16).replace('T',' ')} UTC</time></small><small>만료: {new Date(session.expiresAt).toISOString().slice(0,10)}</small></div><button type="button" className="button secondary" disabled={busy} onClick={()=>void run(async()=>{const result=await api<{current:boolean}>(`/api/auth/sessions/${session.id}`,{method:'DELETE'});if(result.current)signedOut();else{setSessions(await api<SessionInfo[]>('/api/auth/sessions'));setNotice('선택한 로그인을 종료했습니다.');}})}>로그인 종료<span className="sr-only"> {session.current?'현재':session.id}</span></button></li>)}</ul>
  <div className="account-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await api('/api/auth/sessions',{method:'DELETE'});setSessions(await api<SessionInfo[]>('/api/auth/sessions'));setNotice('다른 로그인을 모두 종료했습니다.');})}>다른 기기 모두 로그아웃</button><button type="button" className="button secondary" disabled={busy} onClick={()=>void run(async()=>{setSessions(await api<SessionInfo[]>('/api/auth/sessions'));setNotice('로그인 목록을 새로고침했습니다.');})}>로그인 목록 새로고침</button></div>
  <h3>회원 탈퇴</h3><p className="muted">탈퇴하면 프로필·등록한 블로그·연락처·알림 설정과 모든 로그인 세션이 삭제됩니다. 삭제한 데이터는 복구할 수 없습니다.</p>
  {!deleting?<button type="button" className="button secondary" disabled={busy} onClick={()=>setDeleting(true)}>회원 탈퇴</button>:<form className="account-form account-delete" onSubmit={remove}><p>{user.email} 계정을 삭제합니다.</p><label>확인 이메일<input name="confirmEmail" type="email" className="field" autoComplete="off" required disabled={busy}/></label><label>탈퇴 확인 비밀번호<input name="currentPassword" type="password" className="field" autoComplete="current-password" required maxLength={128} disabled={busy}/></label><div className="account-actions"><button type="submit" className="button" disabled={busy}>계정 영구 삭제</button><button type="button" className="button secondary" disabled={busy} onClick={()=>setDeleting(false)}>탈퇴 취소</button></div></form>}
 </section>;
}
