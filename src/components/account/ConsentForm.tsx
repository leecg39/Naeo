'use client';
import {useState} from 'react';
import {api} from '@/lib/api-client';

/** 외부 앱 연결 동의: 승인·거부 모두 서버가 만든 주소로 앱에 돌아간다. */
export default function ConsentForm({params,appName,kind,redirectHost,scopes}:{params:Record<string,string>;appName:string;kind:'mcp'|'extension';redirectHost:string;scopes:{scope:string;label:string}[]}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function decide(decision:'approve'|'deny'){
  setBusy(true);setError('');
  try{const r=await api<{redirect:string}>('/api/oauth/authorize',{method:'POST',body:{...params,decision}});window.location.href=r.redirect;}
  catch(e){setError(e instanceof Error?e.message:'처리하지 못했습니다.');setBusy(false);}
 }
 return <div className="account-form" aria-label="앱 연결 동의">
  <p><strong>{appName}</strong>{kind==='extension'?' (브라우저 확장 프로그램)':''}이 내 NAEO 계정에 연결하려고 합니다.</p>
  <ul style={{margin:0,paddingLeft:20,display:'grid',gap:6}}>{scopes.map(s=><li key={s.scope}>{s.label} <span className="muted">({s.scope})</span></li>)}</ul>
  <p className="muted">승인하면 {redirectHost}(으)로 돌아갑니다. 연결은 설정 &gt; 연결된 앱에서 언제든 해제할 수 있어요.</p>
  {error&&<p role="alert" className="account-error">{error}</p>}
  <div className="account-actions"><button className="button" type="button" disabled={busy} onClick={()=>void decide('approve')}>승인</button><button className="button secondary" type="button" disabled={busy} onClick={()=>void decide('deny')}>거부</button></div>
 </div>;
}
