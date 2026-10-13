import {useEffect,useMemo,useState,type FormEvent} from 'react';
import {api,ApiError} from '@/lib/api-client';
import type {Article,Category} from '@/server/content/articles';
import type {Revision} from '@/server/content/admin-articles';

export type ArticleDetail=Article&{revisions:Revision[]};
type Check={headings:{depth:number;id:string;text:string}[];warnings:string[];readMinutes:number};
type Form={categoryId:string;slug:string;title:string;summary:string;showSummary:boolean;tags:string;coverImage:string;featured:boolean;status:Article['status'];publishedAt:string;readMinutes:string;position:string;bodyMarkdown:string};
type Props={article:ArticleDetail|null;categories:Category[];now:number;busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onSaved:(a:ArticleDetail|null,message:string)=>Promise<void>;onClose:()=>void};

/** datetime-local 입력값은 브라우저 현지 시각이다. 저장할 때 ISO(UTC)로 바꾼다. */
const toLocalInput=(ms:number|null)=>ms?new Date(ms-new Date(ms).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
const toIso=(local:string)=>local?new Date(local).toISOString():null;
function formOf(a:ArticleDetail|null,categories:Category[]):Form{
 return a?{categoryId:a.category.id,slug:a.slug,title:a.title,summary:a.summary,showSummary:a.showSummary,tags:a.tags.join(', '),coverImage:a.coverImage,featured:a.featured,status:a.status,publishedAt:toLocalInput(a.publishedAt),readMinutes:String(a.readMinutes),position:String(a.position),bodyMarkdown:a.bodyMarkdown}
  :{categoryId:categories[0]?.id??'',slug:'',title:'',summary:'',showSummary:true,tags:'',coverImage:'',featured:false,status:'draft',publishedAt:'',readMinutes:'',position:'0',bodyMarkdown:''};
}
/** 폼 값을 API 필드로 바꾼다. 비워 둔 읽는 시간은 서버 자동 계산에 맡긴다. */
function payload(f:Form){
 const tags=f.tags.split(',').map(t=>t.trim()).filter(Boolean);
 return{categoryId:f.categoryId,slug:f.slug.trim(),title:f.title,summary:f.summary,showSummary:f.showSummary,tags,coverImage:f.coverImage.trim(),featured:f.featured,status:f.status,publishedAt:toIso(f.publishedAt),...(f.readMinutes.trim()?{readMinutes:Number(f.readMinutes)}:{}),position:Number(f.position||0),bodyMarkdown:f.bodyMarkdown};
}
function changed(before:ReturnType<typeof payload>,after:ReturnType<typeof payload>){
 return Object.fromEntries(Object.entries(after).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify((before as Record<string,unknown>)[k])));
}
const fmt=(ms:number)=>new Date(ms).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'});

export default function ArticleEditor({article,categories,now,busy,run,onSaved,onClose}:Props){
 const initial=useMemo(()=>formOf(article,categories),[article,categories]);
 const [form,setForm]=useState(initial),[check,setCheck]=useState<Check|null>(null),[warnings,setWarnings]=useState<string[]>([]);
 const [deleting,setDeleting]=useState(false),[confirmSlug,setConfirmSlug]=useState('');
 const dirty=JSON.stringify(form)!==JSON.stringify(initial);
 const set=<K extends keyof Form>(key:K,value:Form[K])=>setForm(f=>({...f,[key]:value}));
 useEffect(()=>{
  if(!dirty)return;
  const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};
  window.addEventListener('beforeunload',warn);
  return()=>window.removeEventListener('beforeunload',warn);
 },[dirty]);

 const withWarnings=async<T,>(action:()=>Promise<T>)=>{
  setWarnings([]);
  try{return await action();}
  catch(e){if(e instanceof ApiError&&Array.isArray(e.details))setWarnings(e.details.map(String));throw e;}
 };
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  if(!article){
   const created=await withWarnings(()=>api<Article>('/api/admin/articles',{method:'POST',body:payload(form)}));
   await onSaved(await api<ArticleDetail>(`/api/admin/articles/${created.id}`),'글을 만들었습니다.');return;
  }
  const diff=changed(payload(initial),payload(form));
  if(!Object.keys(diff).length){await onSaved(article,'바뀐 내용이 없습니다.');return;}
  await withWarnings(()=>api<Article>(`/api/admin/articles/${article.id}`,{method:'PATCH',body:{...diff,version:article.version}}));
  await onSaved(await api<ArticleDetail>(`/api/admin/articles/${article.id}`),'저장했습니다. 공개 글은 바로 반영됩니다.');
 });};
 const runCheck=()=>void run(async()=>{setCheck(await api<Check>('/api/admin/articles/preview',{method:'POST',body:{bodyMarkdown:form.bodyMarkdown}}));});
 const restore=(revision:number)=>void run(async()=>{
  if(!article)return;
  await api(`/api/admin/articles/${article.id}/restore`,{method:'POST',body:{revision,version:article.version}});
  await onSaved(await api<ArticleDetail>(`/api/admin/articles/${article.id}`),`${revision}번 버전 내용으로 되돌렸습니다.`);
 });
 const remove=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  if(!article)return;
  await api(`/api/admin/articles/${article.id}`,{method:'DELETE',body:{version:article.version}});
  await onSaved(null,'글을 삭제했습니다. 공개 주소는 이제 404입니다.');
 });};
 const live=article?.status==='published'&&article.publishedAt!==null&&article.publishedAt<=now;

 return <section className="panel account-card" aria-label={article?'글 편집':'새 글 쓰기'}>
  <h2>{article?'글 편집':'새 글 쓰기'}</h2>
  {article&&<p className="muted">{article.url} · 버전 {article.version}{dirty?' · 저장하지 않은 변경 있음':''}</p>}
  {article&&<div className="account-actions" style={{marginBottom:16}}>
   <a className="button secondary" href={`/admin/blog/preview/${article.id}`} target="_blank" rel="noopener">미리보기</a>
   {live&&<a className="button secondary" href={article.url} target="_blank" rel="noopener">공개 페이지</a>}
  </div>}
  <form className="account-form article-form" onSubmit={save}>
   <label>분류<select className="field" value={form.categoryId} onChange={e=>set('categoryId',e.target.value)} required disabled={busy}>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label>주소(영문 소문자·숫자·-)<input className="field" value={form.slug} onChange={e=>set('slug',e.target.value)} required maxLength={80} pattern="[a-z0-9](?:[a-z0-9\-]{0,78}[a-z0-9])?" disabled={busy}/></label>
   <label>제목<input className="field" value={form.title} onChange={e=>set('title',e.target.value)} required maxLength={200} disabled={busy}/></label>
   <label>요약<textarea className="field" value={form.summary} onChange={e=>set('summary',e.target.value)} maxLength={500} rows={2} disabled={busy}/></label>
   <label className="account-checkbox"><input type="checkbox" checked={form.showSummary} onChange={e=>set('showSummary',e.target.checked)} disabled={busy}/> 글 머리말에 요약 표시</label>
   <label>태그(쉼표로 구분, 최대 10개)<input className="field" value={form.tags} onChange={e=>set('tags',e.target.value)} disabled={busy}/></label>
   <label>목록 썸네일(/assets/… 또는 https 주소)<input className="field" value={form.coverImage} onChange={e=>set('coverImage',e.target.value)} maxLength={300} disabled={busy}/></label>
   <label>상태<select className="field" value={form.status} onChange={e=>set('status',e.target.value as Article['status'])} disabled={busy}><option value="draft">초안</option><option value="published">공개(게시일이 미래면 예약)</option><option value="archived">비공개</option></select></label>
   <label>게시일(비우면 공개 시점)<input className="field" type="datetime-local" value={form.publishedAt} onChange={e=>set('publishedAt',e.target.value)} disabled={busy}/></label>
   <label>읽는 시간(분, 비우면 자동)<input className="field" type="number" min={1} max={600} value={form.readMinutes} onChange={e=>set('readMinutes',e.target.value)} disabled={busy}/></label>
   <label>순서(같은 날짜일 때 작은 값 먼저)<input className="field" type="number" min={-10000} max={10000} value={form.position} onChange={e=>set('position',e.target.value)} disabled={busy}/></label>
   <label className="account-checkbox"><input type="checkbox" checked={form.featured} onChange={e=>set('featured',e.target.checked)} disabled={busy}/> 추천 가이드에 표시</label>
   <label>본문(마크다운)<textarea className="field article-body" value={form.bodyMarkdown} onChange={e=>set('bodyMarkdown',e.target.value)} rows={18} spellCheck={false} disabled={busy}/></label>
   <p className="muted">지원: 제목(##, ###)·굵게·기울임·취소선·코드·링크·이미지·표·목록·인용·구분선, 구성 요소 <code>::mate-promo</code>, <code>::picture{'{src="" alt=""}'}</code>, <code>::event-cta{'{href="" label="" aria=""}'}</code>. HTML 태그는 저장할 수 없습니다.</p>
   {warnings.length>0&&<ul role="alert" className="account-error">{warnings.map(w=><li key={w}>{w}</li>)}</ul>}
   {check&&<div role="status" className="article-check">
    <p>목차 {check.headings.length}개 · 예상 읽는 시간 {check.readMinutes}분 · {check.warnings.length?`문제 ${check.warnings.length}건`:'문제 없음'}</p>
    {check.warnings.length>0&&<ul>{check.warnings.map(w=><li key={w}>{w}</li>)}</ul>}
   </div>}
   <div className="account-actions">
    <button className="button" type="submit" disabled={busy}>{article?'저장':'글 만들기'}</button>
    <button className="button secondary" type="button" disabled={busy} onClick={runCheck}>본문 검사</button>
    {article&&<button className="button secondary" type="button" disabled={busy} onClick={()=>setDeleting(true)}>삭제</button>}
    <button className="button secondary" type="button" disabled={busy} onClick={()=>{if(!dirty||window.confirm('저장하지 않은 변경을 버릴까요?'))onClose();}}>닫기</button>
   </div>
  </form>
  {deleting&&article&&<form className="account-form account-delete" style={{marginTop:20}} onSubmit={remove}>
   <h3>글 삭제 확인</h3>
   <p>삭제하면 되돌릴 수 없고 수정 이력도 함께 지워집니다. 공개하지 않으려면 상태를 &apos;비공개&apos;로 바꾸세요.</p>
   <label>확인을 위해 글 주소 &lsquo;{article.slug}&rsquo; 입력<input className="field" value={confirmSlug} onChange={e=>setConfirmSlug(e.target.value)} autoComplete="off" disabled={busy}/></label>
   <div className="account-actions"><button className="button" type="submit" disabled={busy||confirmSlug!==article.slug}>영구 삭제</button><button className="button secondary" type="button" disabled={busy} onClick={()=>{setDeleting(false);setConfirmSlug('');}}>취소</button></div>
  </form>}
  {article&&article.revisions.length>0&&<div style={{marginTop:24}}>
   <h3>수정 이력</h3>
   <ul className="revision-list">{article.revisions.map(r=><li key={r.version}>
    <span>버전 {r.version} · {fmt(r.createdAt)}</span>
    {r.version!==article.version&&<button className="button secondary" type="button" disabled={busy||dirty} onClick={()=>restore(r.version)}>이 내용으로 되돌리기<span className="sr-only"> 버전 {r.version}</span></button>}
   </li>)}</ul>
   {dirty&&<p className="muted">저장하지 않은 변경이 있으면 되돌리기를 할 수 없습니다.</p>}
  </div>}
 </section>;
}
