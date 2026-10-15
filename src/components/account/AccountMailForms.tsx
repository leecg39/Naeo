'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {api} from '@/lib/api-client';
import type {mailStatus} from '@/server/mail/account-mail';
type Status=ReturnType<typeof mailStatus>;
export function ForgotPasswordForm({available}:{available:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const email=new FormData(e.currentTarget).get('email');try{const r=await api<{message:string}>('/api/auth/password/forgot',{method:'POST',body:{email}});setNotice(r.message);}catch(e){setError(e instanceof Error?e.message:'요청하지 못했습니다.');}finally{setBusy(false);}}
 return <form method="post" className="account-form" onSubmit={submit}><p>가입한 이메일 주소로 비밀번호를 다시 설정할 수 있는 링크를 요청하세요.</p>{!available&&<p role="status">현재 이메일 안내를 이용할 수 없습니다. 잠시 후 다시 시도하거나 고객 지원에 문의해주세요.</p>}<label>이메일<input type="email" name="email" className="field" autoComplete="email" maxLength={254} required disabled={busy||!available}/></label><button className="button" disabled={busy||!available}>{busy?'요청 중…':'재설정 안내 요청'}</button>{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<p role="alert" className="account-error">{error}</p>}<Link href="/login">로그인으로 돌아가기</Link></form>;
}
export function EmailLinkForm({purpose}:{purpose:'reset'|'verify'}){
 const token=useRef(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
 useEffect(()=>{token.current ||= new URLSearchParams(window.location.hash.slice(1)).get('token')??'';window.history.replaceState(null,'',window.location.pathname);},[]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setError('');if(!token.current){setError('안내 메일의 링크를 다시 열어주세요.');return;}
  const fields=new FormData(e.currentTarget);if(purpose==='reset'&&fields.get('newPassword')!==fields.get('confirmPassword')){setError('새 비밀번호가 일치하지 않습니다.');return;}
  setBusy(true);try{await api(purpose==='reset'?'/api/auth/password/reset':'/api/auth/email/verify',{method:'POST',body:{token:token.current,...(purpose==='reset'?{newPassword:fields.get('newPassword')}:{})}});token.current='';setDone(true);}catch(e){setError(e instanceof Error?e.message:'링크를 확인하지 못했습니다.');}finally{setBusy(false);}
 }
 if(done)return <div className="account-form"><p role="status" className="account-success">{purpose==='reset'?'비밀번호를 변경하고 모든 로그인과 외부 앱 연결을 종료했습니다. 새 비밀번호로 로그인해주세요.':'이메일 주소를 확인했습니다. 로그인한 뒤 계정 설정에서 확인할 수 있습니다.'}</p><Link className="button" href="/login">로그인으로 이동</Link></div>;
 return <form method="post" className="account-form" onSubmit={submit}><p>{purpose==='reset'?'새 비밀번호를 입력한 뒤 변경을 눌러주세요.':'이메일 주소를 확인하려면 아래 버튼을 눌러주세요.'}</p>{purpose==='reset'&&<><label>새 비밀번호<input className="field" type="password" name="newPassword" autoComplete="new-password" minLength={10} maxLength={128} required disabled={busy}/></label><label>새 비밀번호 확인<input className="field" type="password" name="confirmPassword" autoComplete="new-password" minLength={10} maxLength={128} required disabled={busy}/></label></>}<button className="button" disabled={busy}>{busy?'처리 중…':purpose==='reset'?'비밀번호 변경':'이메일 주소 확인'}</button>{error&&<p role="alert" className="account-error">{error}</p>}<Link href={purpose==='reset'?'/auth/forgot-password':'/dashboard/settings'}>안내 메일 다시 요청하기</Link></form>;
}
const STATE:Record<string,string>={queued:'안내 메일 준비 중',sending:'메일 서비스에 요청 중',retry:'잠시 후 자동으로 다시 시도합니다',accepted:'메일 서비스가 접수했습니다. 받은편지함과 스팸함을 확인해주세요.',failed:'안내 메일을 보내지 못했습니다. 잠시 후 다시 요청해주세요.'};
export function EmailVerification({initial,email}:{initial:Status;email:string}){
 const [status,setStatus]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let ended=false;const refresh=async()=>{try{const s=await api<Status>('/api/auth/email/status');if(!ended)setStatus(s);}catch{/* Explicit refresh surfaces session/network errors. */}};const timer=setInterval(refresh,10000);return()=>{ended=true;clearInterval(timer);};},[]);
 async function run(send:boolean){setBusy(true);setError('');try{if(send)await api('/api/auth/email/request',{method:'POST',body:{}});setStatus(await api<Status>('/api/auth/email/status'));}catch(e){setError(e instanceof Error?e.message:'확인하지 못했습니다.');}finally{setBusy(false);}}
 return <section className="panel account-card"><h2>이메일 인증</h2><p>{email}</p><p role="status">{status.verified?'인증된 이메일입니다.':!status.available?'현재 이메일 안내를 이용할 수 없습니다.':STATE[status.latest?.state??'']??'메일로 이메일 주소를 확인해주세요.'}</p>{!status.verified&&<button className="button" disabled={busy||!status.available} onClick={()=>void run(true)}>인증 메일 요청</button>}<button className="button secondary" disabled={busy} onClick={()=>void run(false)}>인증 상태 새로고침</button>{error&&<p role="alert" className="account-error">{error}</p>}</section>;
}
