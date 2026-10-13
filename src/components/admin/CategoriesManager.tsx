import {useState,type FormEvent} from 'react';
import {api} from '@/lib/api-client';
import type {Category} from '@/server/content/articles';

type Props={categories:Category[];busy:boolean;run:(a:()=>Promise<void>)=>Promise<void>;onChanged:(message:string)=>Promise<void>};

function CategoryRow({c,busy,run,onChanged}:{c:Category}&Omit<Props,'categories'>){
 const [name,setName]=useState(c.name),[slug,setSlug]=useState(c.slug),[sortOrder,setSortOrder]=useState(String(c.sortOrder));
 const save=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
  const body={...(name!==c.name?{name}:{}),...(slug!==c.slug?{slug}:{}),...(Number(sortOrder)!==c.sortOrder?{sortOrder:Number(sortOrder)}:{}),version:c.version};
  if(Object.keys(body).length===1){await onChanged('바뀐 내용이 없습니다.');return;}
  await api(`/api/admin/article-categories/${c.id}`,{method:'PATCH',body});
  await onChanged(slug!==c.slug?`분류를 저장했습니다. 이 분류의 글 주소가 /blog/${slug}/… 로 바뀌었습니다.`:'분류를 저장했습니다.');
 });};
 const remove=()=>void run(async()=>{
  if(!window.confirm(`'${c.name}' 분류를 삭제할까요?`))return;
  await api(`/api/admin/article-categories/${c.id}`,{method:'DELETE',body:{version:c.version}});
  await onChanged('분류를 삭제했습니다.');
 });
 return <tr>
  <td><form id={`category-${c.id}`} onSubmit={save}/><input className="field" form={`category-${c.id}`} aria-label={`${c.name} 이름`} value={name} onChange={e=>setName(e.target.value)} required maxLength={30} disabled={busy}/></td>
  <td><input className="field" form={`category-${c.id}`} aria-label={`${c.name} 주소`} value={slug} onChange={e=>setSlug(e.target.value)} required maxLength={40} pattern="[a-z0-9](?:[a-z0-9\-]{0,78}[a-z0-9])?" disabled={busy}/></td>
  <td><input className="field" form={`category-${c.id}`} aria-label={`${c.name} 순서`} type="number" value={sortOrder} onChange={e=>setSortOrder(e.target.value)} min={-1000} max={1000} disabled={busy}/></td>
  <td>{c.publishedCount} / {c.articleCount}</td>
  <td><div className="account-actions">
   <button className="button secondary" type="submit" form={`category-${c.id}`} disabled={busy}>저장<span className="sr-only"> {c.name}</span></button>
   <button className="button secondary" type="button" disabled={busy||c.articleCount>0} title={c.articleCount>0?'글이 있는 분류는 삭제할 수 없습니다':undefined} onClick={remove}>삭제<span className="sr-only"> {c.name}</span></button>
  </div></td>
 </tr>;
}

export default function CategoriesManager({categories,busy,run,onChanged}:Props){
 const create=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);void run(async()=>{
  await api('/api/admin/article-categories',{method:'POST',body:{slug:f.get('slug'),name:f.get('name'),sortOrder:Number(f.get('sortOrder')||0)}});
  form.reset();await onChanged('분류를 만들었습니다. 공개 글이 생기면 매거진 탭과 사이드바에 나타납니다.');
 });};
 return <section className="panel account-card">
  <h2>분류</h2>
  <p className="muted">공개 글 수 / 전체 글 수. 글이 있는 분류는 삭제할 수 없으니 먼저 글을 옮기세요.</p>
  <div className="responsive-table"><table className="data-table">
   <caption className="sr-only">매거진 분류 목록</caption>
   <thead><tr><th>이름</th><th>주소</th><th>순서</th><th>글</th><th>관리</th></tr></thead>
   <tbody>{categories.map(c=><CategoryRow key={`${c.id}:${c.version}`} c={c} busy={busy} run={run} onChanged={onChanged}/>)}</tbody>
  </table></div>
  <form className="admin-filters" style={{marginTop:20}} onSubmit={create}>
   <label>새 분류 이름<input className="field" name="name" required maxLength={30} disabled={busy}/></label>
   <label>주소<input className="field" name="slug" required maxLength={40} pattern="[a-z0-9](?:[a-z0-9\-]{0,78}[a-z0-9])?" disabled={busy}/></label>
   <label>순서<input className="field" name="sortOrder" type="number" defaultValue={categories.length} min={-1000} max={1000} disabled={busy}/></label>
   <button className="button" type="submit" disabled={busy}>분류 추가</button>
  </form>
 </section>;
}
