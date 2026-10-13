import {useState} from 'react';

/** 내보내기: 서버가 만든 안전한 HTML을 샌드박스 iframe으로 미리보고, 서식째 복사하거나 파일로 받는다. */
export default function DraftExport({draftId,dirty}:{draftId:string;dirty:boolean}){
 const [preview,setPreview]=useState(''),[message,setMessage]=useState('');
 const fetchExport=async(format:'html'|'text')=>{
  const res=await fetch(`/api/drafts/${draftId}/export?format=${format}`,{credentials:'same-origin',cache:'no-store'});
  if(!res.ok)throw new Error('내보내기를 불러오지 못했습니다.');
  return res.text();
 };
 const run=(action:()=>Promise<string>)=>void action().then(setMessage).catch(e=>setMessage(e instanceof Error?e.message:'처리하지 못했습니다.'));
 const copy=()=>run(async()=>{
  const [html,text]=await Promise.all([fetchExport('html'),fetchExport('text')]);
  if('ClipboardItem' in window){await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})]);return'서식(HTML)째 복사했습니다. 네이버 블로그 에디터에 붙여넣으세요.';}
  await navigator.clipboard.writeText(text);return'텍스트로 복사했습니다(이 브라우저는 서식 복사를 지원하지 않습니다).';
 });
 return <div style={{display:'grid',gap:8}}>
  <strong>내보내기</strong>
  {dirty&&<p style={{margin:0,fontSize:13,color:'#f59e0b'}}>저장하지 않은 변경은 내보내기에 포함되지 않습니다.</p>}
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   <button type="button" className="naeo-button" onClick={()=>run(async()=>{setPreview(await fetchExport('html'));return'미리보기를 열었습니다.';})}>미리보기</button>
   <button type="button" className="naeo-button" onClick={copy}>서식째 복사</button>
   {(['html','markdown','text'] as const).map(f=><a key={f} className="naeo-button" href={`/api/drafts/${draftId}/export?format=${f}&download=1`}>{f==='html'?'HTML':f==='markdown'?'마크다운':'텍스트'} 받기</a>)}
  </div>
  {message&&<p role="status" style={{margin:0,fontSize:13}}>{message}</p>}
  {preview&&<iframe title="내보내기 미리보기" sandbox="" srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font-family:sans-serif;line-height:1.7;padding:16px;color:#111;background:#fff}img{max-width:100%}</style>${preview}`} style={{width:'100%',height:360,border:'1px solid rgba(255,255,255,.2)',borderRadius:8,background:'#fff'}}/>}
 </div>;
}
