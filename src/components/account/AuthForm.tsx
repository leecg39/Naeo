'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, safeNext } from '@/lib/api-client';

export default function AuthForm({next,onSuccess}:{next?:string;onSuccess?:()=>void}) {
  const router=useRouter();
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields=new FormData(event.currentTarget);
    setBusy(true);setError('');
    try {
      await api(`/api/auth/${mode}`,{method:'POST',body:{email:fields.get('email'),password:fields.get('password'),...(mode==='register'?{nickname:fields.get('nickname'),termsAccepted:fields.get('terms')==='on'}:{})}});
      onSuccess?.();
      router.push(safeNext(next));router.refresh();
    } catch(error) {setError(error instanceof Error?error.message:'로그인하지 못했습니다.');}
    finally {setBusy(false);}
  }
  return <div className="account-form">
    <div role="tablist" aria-label="계정 이용 방법" className="account-tabs">
      <button type="button" role="tab" aria-selected={mode==='login'} disabled={busy} onClick={()=>{setMode('login');setError('');}}>로그인</button>
      <button type="button" role="tab" aria-selected={mode==='register'} disabled={busy} onClick={()=>{setMode('register');setError('');}}>회원가입</button>
    </div>
    <form method="post" onSubmit={submit}>
      {mode==='register'&&<label>닉네임<input className="field" name="nickname" autoComplete="nickname" minLength={1} maxLength={30} required disabled={busy}/></label>}
      <label>이메일<input className="field" name="email" type="email" autoComplete="username" maxLength={254} required disabled={busy}/></label>
      <label>비밀번호<input className="field" name="password" type="password" autoComplete={mode==='login'?'current-password':'new-password'} minLength={mode==='register'?10:1} maxLength={128} required disabled={busy}/></label>
      {mode==='register'&&<><p className="muted account-hint">비밀번호는 10자 이상 입력해주세요.</p><label className="account-checkbox"><input name="terms" type="checkbox" required disabled={busy}/><span><a href="/terms" target="_blank" rel="noreferrer">이용약관</a> 및 <a href="/privacy" target="_blank" rel="noreferrer">개인정보 처리방침</a>에 동의합니다.</span></label></>}
      {error&&<p role="alert" className="account-error">{error}</p>}
      <button className="button" type="submit" disabled={busy}>{busy?'처리 중…':mode==='login'?'로그인':'계정 만들기'}</button>
    </form>
    <Link href="/auth/forgot-password">비밀번호를 잊으셨나요?</Link>
  </div>;
}
