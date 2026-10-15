import {useState,type FormEvent} from 'react';
import {api} from '@/lib/api-client';
import {INQUIRY_STATUS_LABELS,INQUIRY_TYPE_LABELS,formatKst,type InquiryStatus} from '@/lib/inquiry-labels';
import type {AdminInquiryDetail} from '@/server/inquiries/admin-inquiries';
import type {InquiryTemplate} from '@/server/inquiries/templates';

type Props={inquiry:AdminInquiryDetail;templates:InquiryTemplate[];busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onChanged:(next:AdminInquiryDetail|null,message:string)=>Promise<void>;onClose:()=>void};

function ReplyItem({inquiry,reply,busy,run,onChanged}:Omit<Props,'templates'|'onClose'>&{reply:AdminInquiryDetail['replies'][number]}){
 const [editing,setEditing]=useState(false),[body,setBody]=useState(reply.body);
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  await onChanged(await api<AdminInquiryDetail>(`/api/admin/inquiries/${inquiry.id}/replies/${reply.id}`,{method:'PATCH',body:{body,version:inquiry.version}}),'답변을 수정했습니다.');
 });};
 const remove=()=>void run(async()=>{
  if(!window.confirm('이 답변을 삭제할까요? 회원 문의 내역에서도 사라집니다.'))return;
  await onChanged(await api<AdminInquiryDetail>(`/api/admin/inquiries/${inquiry.id}/replies/${reply.id}`,{method:'DELETE',body:{version:inquiry.version}}),'답변을 삭제했습니다.');
 });
 return <li className="inquiry-reply">
  <p className="muted">{reply.authorName??'탈퇴한 관리자'} · {formatKst(reply.createdAt)}{reply.updatedAt!==reply.createdAt?` (수정 ${formatKst(reply.updatedAt)})`:''} · 메일 {reply.mailState?({queued:'발송 대기',sending:'접수 요청 중',retry:'자동 재시도 대기',accepted:'메일 서비스 접수 완료 (수신 미확인)',failed:'실패 · 재전송 전 공급자 내역 확인'}[reply.mailState]):'미발송'}</p>
  {editing?<form className="account-form" onSubmit={save}>
   <label>답변 수정<textarea className="field" value={body} onChange={e=>setBody(e.target.value)} rows={5} required maxLength={10000} disabled={busy}/></label>
   <div className="account-actions"><button className="button" type="submit" disabled={busy}>답변 저장</button><button className="button secondary" type="button" disabled={busy} onClick={()=>{setEditing(false);setBody(reply.body);}}>취소</button></div>
  </form>:<>
   <p className="inquiry-text">{reply.body}</p>
   {!reply.mailState&&<button className="button" type="button" disabled={busy} onClick={()=>void run(async()=>{await onChanged(await api<AdminInquiryDetail>(`/api/admin/inquiries/${inquiry.id}/replies/${reply.id}/send`,{method:'POST',body:{version:inquiry.version}}),'메일 발송을 요청했습니다. 상태를 새로고침해 확인해주세요.');})}>회신 이메일로 발송 요청</button>}
   <div className="account-actions"><button className="button secondary" type="button" disabled={busy||!!reply.mailState} onClick={()=>setEditing(true)}>답변 수정</button><button className="button secondary" type="button" disabled={busy} onClick={remove}>답변 삭제</button></div>
  </>}
 </li>;
}

export default function InquiryDetail({inquiry,templates,busy,run,onChanged,onClose}:Props){
 const [reply,setReply]=useState(''),[status,setStatus]=useState<InquiryStatus>(inquiry.status),[confirm,setConfirm]=useState('');
 const send=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  await onChanged(await api<AdminInquiryDetail>(`/api/admin/inquiries/${inquiry.id}/replies`,{method:'POST',body:{body:reply,version:inquiry.version}}),'답변을 저장했습니다. 이메일은 별도로 발송 요청해주세요.');
 });};
 const saveStatus=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  await onChanged(await api<AdminInquiryDetail>(`/api/admin/inquiries/${inquiry.id}`,{method:'PATCH',body:{status,version:inquiry.version}}),'상태를 바꿨습니다.');
 });};
 const remove=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  await api(`/api/admin/inquiries/${inquiry.id}`,{method:'DELETE',body:{version:inquiry.version}});
  await onChanged(null,'문의를 삭제했습니다.');
 });};
 return <section className="panel account-card" aria-label="문의 상세">
  <h2>{inquiry.subject||'(제목 없음)'}</h2>
  <p className="muted">{INQUIRY_TYPE_LABELS[inquiry.type]} · {INQUIRY_STATUS_LABELS[inquiry.status]} · 접수 {formatKst(inquiry.createdAt)} · 버전 {inquiry.version}</p>
  <p>회신 이메일 <a href={`mailto:${inquiry.email}`}>{inquiry.email}</a>{inquiry.ownerEmail?` · 회원 ${inquiry.ownerEmail}`:' · 비회원'}</p>
  <p className="inquiry-text">{inquiry.message}</p>
  <h3>답변 {inquiry.replies.length}개</h3>
  <button className="button secondary" type="button" disabled={busy} onClick={()=>void run(async()=>{await onChanged(await api<AdminInquiryDetail>(`/api/admin/inquiries/${inquiry.id}`),'발송 상태를 갱신했습니다.');})}>발송 상태 새로고침</button>
  {inquiry.replies.length>0&&<ul className="inquiry-replies">{inquiry.replies.map(r=><ReplyItem key={`${r.id}:${r.updatedAt}`} inquiry={inquiry} reply={r} busy={busy} run={run} onChanged={onChanged}/>)}</ul>}
  <form className="account-form" onSubmit={send}>
   {templates.length>0&&<label>템플릿 넣기<select className="field" value="" onChange={e=>{const t=templates.find(x=>x.id===e.target.value);if(t)setReply(t.body);}} disabled={busy}><option value="">템플릿 선택</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
   <label>새 답변<textarea className="field" value={reply} onChange={e=>setReply(e.target.value)} rows={6} required maxLength={10000} disabled={busy}/></label>
   <p className="muted account-hint">저장 후 회신 이메일로 발송을 요청할 수 있습니다. 발송 요청한 답변은 수정할 수 없습니다. 삭제해도 전송 중이거나 이미 도착한 메일은 회수되지 않습니다.</p>
   <div className="account-actions"><button className="button" type="submit" disabled={busy||!reply.trim()}>답변 저장</button></div>
  </form>
  <form className="admin-filters" style={{marginTop:24}} onSubmit={saveStatus}>
   <label>처리 상태<select className="field" value={status} onChange={e=>setStatus(e.target.value as InquiryStatus)} disabled={busy}>{Object.entries(INQUIRY_STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
   <button className="button secondary" type="submit" disabled={busy||status===inquiry.status}>상태 저장</button>
   <button className="button secondary" type="button" disabled={busy} onClick={onClose}>닫기</button>
  </form>
  <form className="account-form account-delete" style={{marginTop:24}} onSubmit={remove}>
   <h3>문의 삭제</h3>
   <p>문의와 답변이 영구 삭제됩니다.</p>
   <label>확인을 위해 회신 이메일 &lsquo;{inquiry.email}&rsquo; 입력<input className="field" value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="off" disabled={busy}/></label>
   <div className="account-actions"><button className="button" type="submit" disabled={busy||confirm.trim().toLowerCase()!==inquiry.email}>문의 영구 삭제</button></div>
  </form>
 </section>;
}
