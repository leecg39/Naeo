'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {api} from '@/lib/api-client';
import type {Contact} from '@/server/preferences';
export default function PhoneVerification({contact,onChange}:{contact:Contact;onChange:(contact:Contact)=>void}){
 const [available,setAvailable]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[code,setCode]=useState('');
 useEffect(()=>{let live=true;api<{available:boolean}>('/api/auth/phone/status').then(r=>{if(live)setAvailable(r.available);}).catch(()=>{if(live)setError('인증 서비스 상태를 확인하지 못했습니다.');});return()=>{live=false;};},[]);
 async function run(action:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'인증 요청에 실패했습니다.');}finally{setBusy(false);}}
 async function check(e:FormEvent){e.preventDefault();await run(async()=>{const r=await api<{verified:boolean;contact:Contact}>('/api/auth/phone/check',{method:'POST',body:{code}});setCode('');if(r.verified){onChange(r.contact);setNotice('휴대폰 번호를 확인했습니다.');}else setError('코드가 일치하지 않습니다. 다시 입력해주세요.');});}
 return <div className="account-form"><h3>휴대폰 번호 인증</h3><p>저장한 번호 {contact.phone}로 인증 문자를 요청합니다. 국내 번호는 010으로, 해외 번호는 국가번호를 포함한 + 형식으로 저장해주세요.</p>{!available&&<p role="status">현재 휴대폰 인증을 이용할 수 없습니다.</p>}<button type="button" className="button secondary" disabled={busy||!available||!!contact.phoneVerifiedAt} onClick={()=>void run(async()=>{await api('/api/auth/phone/request',{method:'POST',body:{}});setNotice('문자 발송을 요청했습니다. 도착한 코드를 10분 안에 입력해주세요. 새 요청은 60초 후 가능합니다.');})}>인증 문자 요청</button><form method="post" onSubmit={check}><label>인증 코드<input className="field" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,10}" minLength={4} maxLength={10} required value={code} onChange={e=>setCode(e.target.value)} disabled={busy||!available||!!contact.phoneVerifiedAt}/></label><button className="button" disabled={busy||!available||!!contact.phoneVerifiedAt}>코드 확인</button></form>{notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>;
}
