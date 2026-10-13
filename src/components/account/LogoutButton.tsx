'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
export default function LogoutButton() {
  const router=useRouter(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <><button type="button" className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await api('/api/auth/logout',{method:'POST'});router.push('/login');router.refresh();}catch(error){setError(error instanceof Error?error.message:'로그아웃하지 못했습니다.');}finally{setBusy(false);}}}>{busy?'처리 중…':'로그아웃'}</button>{error&&<span role="alert">{error}</span>}</>;
}
