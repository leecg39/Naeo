'use client';
import {kstDateTime} from '@/lib/kst-time';
import {useState} from 'react';
import {api,ApiError} from '@/lib/api-client';
import type {AuthorizedApp} from '@/server/oauth/authz';

const day=(ms:number)=>kstDateTime(ms);
/** 외부 앱(MCP 클라이언트·확장 프로그램) 연결 목록과 해제. 해제하면 그 앱의 모든 토큰이 즉시 무효가 된다. */
export default function ConnectedApps({initial,mcpUrl}:{initial:AuthorizedApp[];mcpUrl:string}){
 const [apps,setApps]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const revoke=(a:AuthorizedApp)=>{setBusy(true);setError('');setNotice('');void api(`/api/account/apps/${encodeURIComponent(a.clientId)}`,{method:'DELETE'}).then(async()=>{setApps(await api<AuthorizedApp[]>('/api/account/apps'));setNotice(`${a.name} 연결을 해제했어요.`);}).catch(e=>setError(e instanceof ApiError||e instanceof Error?e.message:'해제하지 못했어요.')).finally(()=>setBusy(false));};
 return <section className="panel account-card" id="apps" aria-label="연결된 앱">
  <h2>연결된 앱</h2>
  <p className="muted">ChatGPT·Claude 같은 AI 앱에 MCP 서버 주소 <code>{mcpUrl}</code>를 추가하면 NAEO 로그인 후 연결할 수 있어요.</p>
  <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>
  {apps.length?<div className="responsive-table"><table className="data-table"><caption className="sr-only">연결된 앱 목록</caption>
   <thead><tr><th>앱</th><th>권한</th><th>연결</th><th>마지막 사용</th><th>호출</th><th>관리</th></tr></thead>
   <tbody>{apps.map(a=><tr key={a.clientId}><td><strong>{a.name}</strong>{a.kind==='extension'&&<span className="muted"> · 확장 프로그램</span>}</td><td>{a.scopes.join(', ')}</td><td>{day(a.connectedAt)}</td><td>{a.lastUsedAt?day(a.lastUsedAt):'-'}</td><td>{a.calls}</td>
    <td><button className="button secondary" type="button" disabled={busy} onClick={()=>revoke(a)}>연결 해제<span className="sr-only"> {a.name}</span></button></td></tr>)}</tbody></table></div>
  :<p className="muted">연결된 앱이 없어요.</p>}
 </section>;
}
