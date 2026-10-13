import {useEffect,useState,type FormEvent} from 'react';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import {INQUIRY_STATUS_LABELS,INQUIRY_TYPE_LABELS,formatKst,type InquiryType} from '@/lib/inquiry-labels';
import type {Inquiry,Reply} from '@/server/inquiries/records';

type Detail=Inquiry&{replies:Reply[]};
type State={kind:'loading'}|{kind:'guest'}|{kind:'error';message:string}|{kind:'list';result:PageResult<Inquiry>};
const box={display:'grid',gap:12} as const;
const card={border:'1px solid #ffffff20',borderRadius:8,padding:'12px 14px',textAlign:'left' as const,background:'transparent',color:'inherit',font:'inherit',cursor:'pointer',width:'100%'};
const text={whiteSpace:'pre-wrap' as const,overflowWrap:'anywhere' as const,border:'1px solid #ffffff20',borderRadius:8,padding:'10px 12px',margin:0};
const field={width:'100%',padding:'10px 12px',borderRadius:6,border:'1px solid #ffffff30',background:'transparent',color:'inherit',font:'inherit'};
const muted={color:'#a3a3a3',fontSize:13,margin:0};

function Editor({item,onSaved,onCancel}:{item:Detail;onSaved:(d:Detail,m:string)=>void;onCancel:()=>void}){
 const [type,setType]=useState<InquiryType>(item.type),[subject,setSubject]=useState(item.subject),[message,setMessage]=useState(item.message),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const save=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');
  try{await api(`/api/inquiries/${item.id}`,{method:'PATCH',body:{type,subject,message,version:item.version}});onSaved(await api<Detail>(`/api/inquiries/${item.id}`),'문의를 수정했습니다.');}
  catch(err){setError(err instanceof Error?err.message:'수정하지 못했습니다.');}finally{setBusy(false);}};
 return <form style={box} onSubmit={save}>
  <label style={box}>문의 유형<select style={field} value={type} onChange={e=>setType(e.target.value as InquiryType)} disabled={busy}>{Object.entries(INQUIRY_TYPE_LABELS).map(([v,l])=><option key={v} value={v} style={{color:'#111'}}>{l}</option>)}</select></label>
  <label style={box}>제목 (선택)<input style={field} value={subject} onChange={e=>setSubject(e.target.value)} maxLength={200} disabled={busy}/></label>
  <label style={box}>문의 내용<textarea style={field} value={message} onChange={e=>setMessage(e.target.value)} rows={6} required maxLength={5000} disabled={busy}/></label>
  {error&&<p role="alert" style={{color:'#f87171',margin:0}}>{error}</p>}
  <div style={{display:'flex',gap:8}}><button className="naeo-button" type="submit" disabled={busy}>수정 저장</button><button className="naeo-button" type="button" onClick={onCancel} disabled={busy}>취소</button></div>
 </form>;
}

function DetailView({item,onBack,onChanged}:{item:Detail;onBack:()=>void;onChanged:(d:Detail|null,m:string)=>void}){
 const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const editable=item.status==='open'&&item.replies.length===0;
 const remove=async()=>{
  if(!window.confirm('이 문의를 삭제할까요? 답변도 함께 삭제되며 되돌릴 수 없습니다.'))return;
  setBusy(true);setError('');
  try{await api(`/api/inquiries/${item.id}`,{method:'DELETE',body:{version:item.version}});onChanged(null,'문의를 삭제했습니다.');}
  catch(err){setError(err instanceof Error?err.message:'삭제하지 못했습니다.');setBusy(false);}
 };
 if(editing)return <Editor item={item} onSaved={(d,m)=>{setEditing(false);onChanged(d,m);}} onCancel={()=>setEditing(false)}/>;
 return <div style={box}>
  <button className="naeo-button" type="button" onClick={onBack} style={{width:'fit-content'}}>목록으로</button>
  <strong>{item.subject||'(제목 없음)'}</strong>
  <p style={muted}>{INQUIRY_TYPE_LABELS[item.type]} · {INQUIRY_STATUS_LABELS[item.status]} · {formatKst(item.createdAt)} · 회신 {item.email}</p>
  <p style={text}>{item.message}</p>
  {item.replies.length?item.replies.map(r=><div key={r.id} style={box}><p style={muted}>NAEO 운영팀 답변 · {formatKst(r.createdAt)}</p><p style={{...text,borderColor:'#03c75a60'}}>{r.body}</p></div>):<p style={muted}>아직 답변이 없습니다.</p>}
  {error&&<p role="alert" style={{color:'#f87171',margin:0}}>{error}</p>}
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   {editable&&<button className="naeo-button" type="button" onClick={()=>setEditing(true)} disabled={busy}>문의 수정</button>}
   <button className="naeo-button" type="button" onClick={()=>void remove()} disabled={busy}>문의 삭제</button>
  </div>
  {!editable&&<p style={muted}>답변을 받았거나 종료된 문의는 수정할 수 없습니다. 추가 문의는 새로 남겨주세요.</p>}
 </div>;
}

async function fetchList(page:number):Promise<State>{
 try{return {kind:'list',result:await apiResponse<PageResult<Inquiry>>(`/api/inquiries?page=${page}&pageSize=10`)};}
 catch(err){return err instanceof ApiError&&err.status===401?{kind:'guest'}:{kind:'error',message:err instanceof Error?err.message:'문의 내역을 불러오지 못했습니다.'};}
}

/** /contact의 '내 문의 내역' 대화상자. 로그인한 회원 본인의 문의만 서버에서 읽는다. */
export default function MyInquiries({onLogin}:{onLogin:()=>void}){
 const [state,setState]=useState<State>({kind:'loading'}),[detail,setDetail]=useState<Detail|null>(null),[notice,setNotice]=useState('');
 const load=async(page=1)=>setState(await fetchList(page));
 useEffect(()=>{
  let live=true;
  void fetchList(1).then(next=>{if(live)setState(next);});
  return()=>{live=false;};
 },[]);
 const open=async(id:string)=>{setNotice('');try{setDetail(await api<Detail>(`/api/inquiries/${id}`));}catch(err){setNotice(err instanceof Error?err.message:'문의를 열지 못했습니다.');}};
 const changed=(d:Detail|null,message:string)=>{setDetail(d);setNotice(message);void load(state.kind==='list'?state.result.pagination.page:1);};

 if(state.kind==='loading')return <p role="status">불러오는 중…</p>;
 if(state.kind==='guest')return <div style={box}><p>로그인하면 남긴 문의와 답변을 확인·수정·삭제할 수 있습니다. 비회원 문의의 답변은 회신 이메일로 안내드립니다.</p><button className="naeo-button" type="button" onClick={onLogin}>로그인</button></div>;
 if(state.kind==='error')return <p role="alert">{state.message}</p>;
 const {data,pagination}=state.result,pages=Math.max(1,Math.ceil(pagination.total/pagination.pageSize));
 return <div style={box}>
  {notice&&<p role="status" style={{color:'#03c75a',margin:0}}>{notice}</p>}
  {detail?<DetailView key={`${detail.id}:${detail.version}`} item={detail} onBack={()=>{setDetail(null);setNotice('');}} onChanged={changed}/>:<>
   <p style={muted}>총 {pagination.total}건</p>
   {data.length?<ul style={{...box,listStyle:'none',padding:0,margin:0}}>{data.map(i=><li key={i.id}><button type="button" style={card} onClick={()=>void open(i.id)}>
    <strong>{i.subject||'(제목 없음)'}</strong><br/><span style={muted}>{INQUIRY_TYPE_LABELS[i.type]} · {INQUIRY_STATUS_LABELS[i.status]} · {formatKst(i.createdAt)}</span>
   </button></li>)}</ul>:<p>아직 남긴 문의가 없습니다.</p>}
   {pages>1&&<div style={{display:'flex',gap:8,alignItems:'center'}}><button className="naeo-button" type="button" disabled={pagination.page<=1} onClick={()=>void load(pagination.page-1)}>이전</button><span>{pagination.page} / {pages}</span><button className="naeo-button" type="button" disabled={pagination.page>=pages} onClick={()=>void load(pagination.page+1)}>다음</button></div>}
  </>}
 </div>;
}
