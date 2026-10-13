'use client';
import {kstDateTime} from '@/lib/kst-time';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,apiResponse,ApiError,type PageResult} from '@/lib/api-client';
import type {Article,Category} from '@/server/content/articles';
import ArticleEditor,{type ArticleDetail} from './ArticleEditor';
import CategoriesManager from './CategoriesManager';

const STATUS:Record<Article['status'],string>={draft:'초안',published:'공개',archived:'비공개'};
const fmt=(ms:number|null)=>ms!==null?kstDateTime(ms):'—';
function publicState(a:Article,now:number){
 if(a.status!=='published')return STATUS[a.status];
 return a.publishedAt&&a.publishedAt>now?`예약 (${fmt(a.publishedAt)})`:'공개';
}

export default function ArticlesManager({initial,initialCategories,now:serverNow}:{initial:PageResult<Article>;initialCategories:Category[];now:number}){
 const router=useRouter();
 const [result,setResult]=useState(initial),[categories,setCategories]=useState(initialCategories);
 const [q,setQ]=useState(''),[status,setStatus]=useState(''),[category,setCategory]=useState('');
 const [selected,setSelected]=useState<ArticleDetail|null>(null),[creating,setCreating]=useState(false),[tab,setTab]=useState<'articles'|'categories'>('articles');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 // 공개·예약 판단 기준 시각. 저장 직후 방금 공개한 글이 '예약'으로 보이지 않도록 저장 때마다 갱신한다.
 const [now,setNow]=useState(serverNow);
 const totalPages=Math.max(1,Math.ceil(result.pagination.total/result.pagination.pageSize));

 async function run(action:()=>Promise<void>){
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){
   setError(e instanceof Error?e.message:'처리하지 못했습니다.');
   if(e instanceof ApiError&&e.status===401){router.replace('/login?next=/admin/blog');router.refresh();}
  }finally{setBusy(false);}
 }
 async function load(page=result.pagination.page){
  const query=new URLSearchParams({page:String(page),pageSize:'20',q,...(status?{status}:{}),...(category?{category}:{})});
  const next=await apiResponse<PageResult<Article>>(`/api/admin/articles?${query}`);
  if(!next.data.length&&page>1)return load(page-1);
  setResult(next);
 }
 const reloadCategories=async()=>setCategories(await api<Category[]>('/api/admin/article-categories'));
 const open=(id:string)=>run(async()=>{setCreating(false);setSelected(await api<ArticleDetail>(`/api/admin/articles/${id}`));});
 async function saved(a:ArticleDetail|null,message:string){
  setNow(Date.now());setSelected(a);setCreating(false);setNotice(message);
  await Promise.all([load(a?result.pagination.page:1),reloadCategories()]);
 }

 return <div className="settings-sections">
  <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>
  <div className="account-tabs" role="tablist" aria-label="매거진 관리">
   <button type="button" role="tab" aria-selected={tab==='articles'} onClick={()=>setTab('articles')}>글</button>
   <button type="button" role="tab" aria-selected={tab==='categories'} onClick={()=>setTab('categories')}>분류</button>
  </div>
  {tab==='categories'?<CategoriesManager categories={categories} busy={busy} run={run} onChanged={async message=>{await reloadCategories();setNotice(message);}}/>:<>
   <section className="panel account-card">
    <form className="admin-filters" onSubmit={e=>{e.preventDefault();void run(()=>load(1));}}>
     <label>글 검색<input className="field" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder="제목·주소·요약" disabled={busy}/></label>
     <label>상태<select className="field" value={status} onChange={e=>setStatus(e.target.value)} disabled={busy}><option value="">전체 상태</option><option value="draft">초안</option><option value="published">공개·예약</option><option value="archived">비공개</option></select></label>
     <label>분류<select className="field" value={category} onChange={e=>setCategory(e.target.value)} disabled={busy}><option value="">전체 분류</option>{categories.map(c=><option key={c.id} value={c.slug}>{c.name}</option>)}</select></label>
     <button className="button" type="submit" disabled={busy}>검색</button>
     <button className="button secondary" type="button" disabled={busy||!categories.length} onClick={()=>{setSelected(null);setCreating(true);setError('');}}>새 글 쓰기</button>
    </form>
    <p className="muted" style={{marginTop:16}}>총 {result.pagination.total}개</p>
    <div className="responsive-table"><table className="data-table">
     <caption className="sr-only">매거진 글 목록</caption>
     <thead><tr><th>제목 / 주소</th><th>분류</th><th>상태</th><th>게시일</th><th>수정일</th><th>관리</th></tr></thead>
     <tbody>{result.data.map(a=><tr key={a.id}>
      <td><strong>{a.title}</strong><br/><span className="muted">{a.url}</span></td>
      <td>{a.category.name}</td><td>{publicState(a,now)}</td><td>{fmt(a.publishedAt)}</td><td>{fmt(a.updatedAt)}</td>
      <td><button className="button secondary" type="button" disabled={busy} onClick={()=>void open(a.id)}>편집<span className="sr-only"> {a.title}</span></button></td>
     </tr>)}</tbody>
    </table>{!result.data.length&&<p className="empty-state">조건에 맞는 글이 없습니다.</p>}</div>
    <div className="account-actions" style={{marginTop:20}}>
     <button type="button" className="button secondary" disabled={busy||result.pagination.page<=1} onClick={()=>void run(()=>load(result.pagination.page-1))}>이전</button>
     <span aria-live="polite">{result.pagination.page} / {totalPages}</span>
     <button type="button" className="button secondary" disabled={busy||result.pagination.page>=totalPages} onClick={()=>void run(()=>load(result.pagination.page+1))}>다음</button>
    </div>
   </section>
   {(creating||selected)&&<ArticleEditor key={selected?`${selected.id}:${selected.version}`:'new'} article={selected} categories={categories} now={now} busy={busy} run={run} onSaved={saved} onClose={()=>{setSelected(null);setCreating(false);}}/>}
  </>}
 </div>;
}
