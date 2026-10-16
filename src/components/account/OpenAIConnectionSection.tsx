'use client';
import {useState} from 'react';
import OperationNotice from '../admin/OperationNotice';
import {api,ApiError} from '@/lib/api-client';
import {kstDate} from '@/lib/kst-time';
import type {OpenAIConnectionView} from '@/server/openai/connection';

export type OpenAIConnectionState={configured:boolean;connection:OpenAIConnectionView};
const ERRORS:Record<string,string>={
 OPENAI_LOGIN_REQUIRED:'ChatGPT 연결을 완료하려면 다시 로그인해주세요.',
 OPENAI_STATE_INVALID:'연결 요청이 만료되었거나 브라우저 확인에 실패했습니다. 다시 시도해주세요.',
 OPENAI_DENIED:'ChatGPT 연결을 취소했거나 필요한 권한을 허용하지 않았습니다.',
 OPENAI_NOT_CONFIGURED:'배포 서비스용 ChatGPT 연결 클라이언트가 아직 설정되지 않았습니다.',
 OPENAI_EXCHANGE_FAILED:'OpenAI가 연결 요청을 거절했습니다. 잠시 후 다시 시도해주세요.',
 OPENAI_USAGE_SCOPE_REQUIRED:'ChatGPT 사용량 권한이 허용되지 않았습니다.',
 OPENAI_ID_TOKEN_INVALID:'ChatGPT 계정 확인에 실패했습니다. 다시 연결해주세요.',
 OPENAI_ALREADY_LINKED:'이 ChatGPT 계정은 이미 다른 NAEO 계정에 연결되어 있습니다.',
 OPENAI_ACCOUNT_MISMATCH:'다른 ChatGPT 계정이 이미 연결되어 있습니다. 먼저 기존 연결을 해제해주세요.',
 OPENAI_UNAVAILABLE:'OpenAI 인증 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.',
};

export default function OpenAIConnectionSection({initial,connected,error:initialError}:{initial:OpenAIConnectionState;connected?:string;error?:string}){
 const [state,setState]=useState(initial),[busy,setBusy]=useState(false);
 const [notice,setNotice]=useState(connected==='1'?'ChatGPT 계정을 연결했어요.':'');
 const [error,setError]=useState(initialError?ERRORS[initialError]??'ChatGPT 계정을 연결하지 못했습니다.':'');
 const disconnect=async()=>{
  setBusy(true);setNotice('');setError('');
  try{
   const result=await api<{disconnected:boolean;remoteRevocationConfirmed:boolean}>('/api/account/openai',{method:'DELETE'});
   setState(await api<OpenAIConnectionState>('/api/account/openai'));
   setNotice(result.remoteRevocationConfirmed?'ChatGPT 연결과 원격 권한을 해제했어요.':'NAEO의 ChatGPT 연결을 해제했어요. OpenAI 계정의 앱 권한도 확인해주세요.');
  }catch(reason){setError(reason instanceof ApiError||reason instanceof Error?reason.message:'연결을 해제하지 못했습니다.');}
  finally{setBusy(false);}
 };
 const connection=state.connection;
 return <section className="panel account-card" id="openai" aria-label="ChatGPT 계정 연결">
  <h2>ChatGPT 계정 연결</h2>
  <p className="muted">회원 본인의 ChatGPT 사용량 권한으로 AI 글쓰기를 이용하기 위한 연결입니다. 비밀번호와 토큰 원문은 표시하지 않습니다.</p>
  <div aria-live="polite"><OperationNotice message={notice}/>{error&&<p role="alert" className="account-error">{error}</p>}</div>
  <div className="account-actions" style={{justifyContent:'space-between'}}>
   <span><strong>OpenAI</strong> {connection.connected?<span className="muted">· {connection.email||connection.name||'연결된 계정'} · {kstDate(connection.connectedAt)} 연결</span>:<span className="muted">· 연결 안 됨</span>}</span>
   {connection.connected?<button className="button secondary" type="button" disabled={busy} onClick={()=>void disconnect()}>{busy?'해제 중…':'연결 해제'}</button>
    :state.configured?<a className="button secondary" href="/api/account/openai/start">ChatGPT로 연결</a>
    :<button className="button secondary" type="button" disabled>승인 클라이언트 미설정</button>}
  </div>
  {!state.configured&&<p className="muted">OpenAI에서 승인한 배포 서비스용 OAuth 클라이언트가 설정되면 연결할 수 있습니다.</p>}
 </section>;
}
