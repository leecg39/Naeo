'use client';
import {useRef,useState,type FormEvent} from 'react';
import {api,apiResponse,ApiError} from '@/lib/api-client';
import type {KeywordWorkspaceData} from '@/lib/keyword-workspace';
import type {Recommendation,RecommendationList,RecommendationQuery} from '@/server/keywords/recommendations';
import type {KeywordSuggestion} from '@/server/keywords/member-keywords';
import OperationNotice from '@/components/admin/OperationNotice';
import styles from './KeywordWorkspace.module.css';

const number=(n:number|null)=>n===null?'—':n.toLocaleString('ko-KR');
const date=(ms:number)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
const queryString=(q:RecommendationQuery)=>new URLSearchParams(Object.entries(q).filter(([key,value])=>key!=='pageSize'&&value!==''&&value!=='all'&&!(key==='sort'&&value==='newest')&&!(key==='page'&&value===1)).map(([k,v])=>[k,String(v)])).toString();
type Edit={phrase?:string;category?:string;note?:string;favorite?:boolean;written?:boolean};

function Details({item,busy,configured,edit,remove,measure}:{item:Recommendation;busy:boolean;configured:boolean;edit:(value:Edit)=>void;remove:()=>void;measure:()=>void}){
 const [phrase,setPhrase]=useState(item.phrase),[category,setCategory]=useState(item.category),[note,setNote]=useState(item.note),[confirm,setConfirm]=useState(false);
 const submit=(e:FormEvent)=>{e.preventDefault();edit({note,...(item.scope==='personal'?{phrase,category}:{})});};
 return <div className={styles.detail}>
  <div className={styles.detailHeader}><div><strong>{item.phrase}</strong><p>{item.measuredAt?`${date(item.measuredAt)} 측정 · ${item.source==='manual'?'관리자 등록 자료':'네이버 검색광고 조회'}`:'검색량을 아직 조회하지 않은 키워드입니다.'}</p>{item.total!==null&&item.documentCount===null&&<p>문서수가 확인되지 않아 포화도와 기회 등급은 표시하지 않습니다.</p>}</div><a className={styles.primary} href={`/dashboard/write?keyword=${encodeURIComponent(item.phrase)}`}>이 키워드로 글쓰기 ↗</a></div>
  <form onSubmit={submit} className={styles.editForm}>
   {item.scope==='personal'&&<><label>키워드<input value={phrase} onChange={e=>setPhrase(e.target.value)} maxLength={60} required disabled={busy}/></label><label>분류<input value={category} onChange={e=>setCategory(e.target.value)} maxLength={30} placeholder="예: 여행" disabled={busy}/></label></>}
   <label className={styles.note}>내 메모<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={500} placeholder="작성할 내용이나 다음 아이디어를 적어두세요." disabled={busy}/><small>{note.length}/500</small></label>
   <div className={styles.detailActions}><button type="submit" disabled={busy}>변경 저장</button>{item.scope==='personal'&&<button type="button" onClick={measure} disabled={busy||!configured} title={configured?'검색량과 문서수 조회':'검색량 조회 연결 후 사용할 수 있습니다.'}>검색량 조회</button>}<a href={`https://search.naver.com/search.naver?query=${encodeURIComponent(item.phrase)}`} target="_blank" rel="noopener noreferrer">네이버 검색 ↗</a>
    {item.scope==='personal'&&(confirm?<span className={styles.deleteConfirm}>키워드를 삭제할까요? <button type="button" disabled={busy} onClick={remove} className={styles.danger}>삭제 확인</button><button type="button" onClick={()=>setConfirm(false)} disabled={busy}>취소</button></span>:<button type="button" className={styles.danger} disabled={busy} onClick={()=>setConfirm(true)}>삭제</button>)}
   </div>
  </form>
 </div>;
}

export default function KeywordWorkspace({initial,libraryMode=false}:{initial:KeywordWorkspaceData;libraryMode?:boolean}){
 const [list,setList]=useState(initial.list),[suggestions,setSuggestions]=useState(initial.suggestions),[query,setQuery]=useState(initial.list.query),[search,setSearch]=useState(initial.list.query.q);
 const [phrase,setPhrase]=useState(''),[category,setCategory]=useState(''),[open,setOpen]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const locked=useRef(false);
 const reload=async(next:RecommendationQuery=query)=>{
  const result=await apiResponse<RecommendationList>(`/api/recommendations?${new URLSearchParams(Object.entries(next).map(([k,v])=>[k,String(v)]))}`);
  setList(result);setQuery(result.query);setSearch(result.query.q);
  const params=queryString(result.query);window.history.replaceState(null,'',`/dashboard/recommendations${libraryMode?'?view=library'+(params?'&'+params:''):params?'?'+params:''}`);
 };
 const perform=async(action:()=>Promise<void>)=>{
  if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');
  try{await action();}catch(e){setError(e instanceof Error?e.message:'요청을 처리하지 못했습니다.');if(e instanceof ApiError&&e.code==='VERSION_CONFLICT')await reload().catch(()=>{});}
  finally{locked.current=false;setBusy(false);}
 };
 const load=(patch:Partial<RecommendationQuery>)=>void perform(async()=>{await reload({...query,page:1,...patch});setOpen(null);});
 const add=(value:{phrase:string;category:string},fromSuggestion=false)=>void perform(async()=>{
  const created=await api<Recommendation>('/api/recommendations',{method:'POST',body:value});
  await reload({...query,q:'',category:'',filter:'personal',period:'all',sort:'newest',page:1});
  if(!fromSuggestion){setPhrase('');setCategory('');}
  setSuggestions(await api<KeywordSuggestion[]>('/api/recommendations/suggestions'));
  setOpen(created.id);setNotice(`‘${created.phrase}’ 키워드를 추가했습니다.`);
 });
 const edit=(item:Recommendation,value:Edit)=>void perform(async()=>{
  await api(`/api/recommendations/${item.id}`,{method:'PATCH',body:{...value,version:item.version}});
  await reload();setNotice(`‘${item.phrase}’ ${value.written!==undefined?(value.written?'작성 완료로 표시했습니다.':'작성 완료를 해제했습니다.'):value.favorite!==undefined?(value.favorite?'즐겨찾기에 저장했습니다.':'즐겨찾기를 해제했습니다.'):'변경 내용을 저장했습니다.'}`);
 });
 const remove=(item:Recommendation)=>void perform(async()=>{
  await api(`/api/recommendations/${item.id}`,{method:'DELETE',body:{version:item.version}});setOpen(null);await reload();setSuggestions(await api<KeywordSuggestion[]>('/api/recommendations/suggestions'));setNotice(`‘${item.phrase}’ 키워드를 삭제했습니다.`);
 });
 const measure=(item:Recommendation)=>void perform(async()=>{await api(`/api/recommendations/${item.id}/metrics`,{method:'POST',body:{version:item.version}});await reload();setNotice('조회한 검색량을 저장했습니다.');});
 const pages=Math.max(1,Math.ceil(list.pagination.total/list.pagination.pageSize));
 const filters:[RecommendationQuery['filter'],string,number][]=[['all','전체 키워드',list.summary.total],['saved','즐겨찾기',list.summary.saved],['written','작성 완료',list.summary.written],['golden','황금 키워드',list.summary.golden],['preempt','선점 기회',list.summary.preempt]];
 const detail=(item:Recommendation)=>open===item.id?<Details key={`${item.id}:${item.version}`} item={item} busy={busy} configured={initial.metricsConfigured} edit={v=>edit(item,v)} remove={()=>remove(item)} measure={()=>measure(item)}/>:null;
 const favorite=(item:Recommendation)=><button type="button" className={styles.star} aria-label={`${item.phrase} 즐겨찾기`} aria-pressed={item.favorite} disabled={busy} onClick={()=>edit(item,{favorite:!item.favorite})}>{item.favorite?'★':'☆'}</button>;
 const written=(item:Recommendation)=><label className={styles.check}><input type="checkbox" checked={item.written} disabled={busy} onChange={e=>edit(item,{written:e.target.checked})} aria-label={`${item.phrase} 작성 완료`}/><span>작성 완료</span></label>;
 const signal=(item:Recommendation)=><span className={`${styles.badge} ${item.golden?styles.gold:item.preempt?styles.green:''}`}>{item.golden?'황금 키워드':item.preempt?'선점 기회':item.saturation===null?'미측정':item.level}</span>;
 return <div data-naeo-live="keyword-workspace" className={styles.workspace} aria-busy={busy}>
  <header className={styles.header}><div><p className={styles.eyebrow}>KEYWORD WORKSPACE</p>{libraryMode?<h2>내 키워드 보관함</h2>:<h1>키워드 추천</h1>}<p>{libraryMode?'관심 있는 키워드를 저장하고, 메모와 작성 상태를 관리하세요.':'내 블로그의 다음 글감을 찾고, 작성까지 한곳에서 관리하세요.'}</p></div><button type="button" disabled={busy} onClick={()=>load({})}>목록 새로고침 ↻</button></header>
  <section className={styles.stats} aria-label="키워드 현황">{filters.map(([filter,label,count])=><button key={filter} type="button" aria-pressed={query.filter===filter} disabled={busy} onClick={()=>load({filter})}><span>{label}</span><strong>{number(count)}</strong><small>{filter==='written'?`${list.summary.total?Math.round(count/list.summary.total*100):0}% 작성`:'클릭하여 보기'}</small></button>)}</section>
  <section className={styles.panel} aria-labelledby="keyword-add-title"><div className={styles.sectionHeading}><div><h2 id="keyword-add-title">내 키워드 추가</h2><p>추가한 키워드와 메모는 나에게만 보입니다.</p></div><span className={styles.badge}>직접 추가</span></div><form className={styles.addForm} onSubmit={e=>{e.preventDefault();add({phrase,category});}}><label>키워드<input name="phrase" value={phrase} onChange={e=>setPhrase(e.target.value)} maxLength={60} required disabled={busy} placeholder="예: 제주 3박4일 여행 코스"/></label><label><span>분류 (선택)</span><input name="category" value={category} onChange={e=>setCategory(e.target.value)} maxLength={30} disabled={busy} placeholder="예: 여행"/></label><button type="submit" className={styles.primary} disabled={busy||!phrase.trim()}>+ 키워드 추가</button></form></section>
  <div className={styles.messages}><OperationNotice message={notice} className={styles.success}/>{error&&<p role="alert" className={styles.error}>{error}</p>}{busy&&<p role="status" className={styles.loading}>처리 중입니다…</p>}</div>
  <section className={styles.panel} aria-labelledby="keyword-suggest-title"><div className={styles.sectionHeading}><div><h2 id="keyword-suggest-title">내 블로그에서 찾은 글감</h2><p>수집한 글의 태그와 제목에서 가져왔어요. 검색량을 확인한 추천과는 구분됩니다.</p></div><span className={styles.badge}>{suggestions.length}개 후보</span></div>
   {suggestions.length?<div className={styles.suggestions}>{suggestions.map(s=><button type="button" key={s.phrase} disabled={busy} onClick={()=>add({phrase:s.phrase,category:s.category},true)} title={`${s.postTitle} · ${s.postCount}개 글에서 발견`}><strong>{s.phrase}</strong><span>{s.postCount}개 글에서 발견</span><b aria-hidden="true">+</b><span className={styles.srOnly}>키워드 추가</span></button>)}</div>:<p className={styles.subtle}>새 글감 후보가 없습니다. <a href="/dashboard">블로그를 스캔</a>하거나 위에서 직접 키워드를 추가해 보세요.</p>}
  </section>
  <section className={styles.panel} aria-labelledby="keyword-list-title">
   <div className={styles.sectionHeading}><div><h2 id="keyword-list-title">키워드 목록 <span>{number(list.pagination.total)}</span></h2><p>공개 추천과 내가 추가한 키워드를 함께 살펴보세요.</p></div><span className={styles.badge}>{initial.metricsConfigured?'검색량 조회 연결됨':'검색량 조회 미연결'}</span></div>
   <form className={styles.filters} role="search" onSubmit={e=>{e.preventDefault();load({q:search});}}><label className={styles.search}>키워드 검색<input value={search} onChange={e=>setSearch(e.target.value)} disabled={busy} maxLength={100} placeholder="키워드·분류 검색"/></label><button type="submit" disabled={busy}>검색</button><label>분류<select value={query.category} disabled={busy} onChange={e=>load({category:e.target.value})}><option value="">전체 분류</option>{list.categories.map(c=><option key={c}>{c}</option>)}</select></label><label>기간<select value={query.period} disabled={busy} onChange={e=>load({period:e.target.value as RecommendationQuery['period']})}><option value="all">전체 기간</option><option value="week">최근 7일</option><option value="month">최근 30일</option></select></label><label>정렬<select value={query.sort} disabled={busy} onChange={e=>load({sort:e.target.value as RecommendationQuery['sort']})}><option value="newest">최신 추가순</option><option value="phrase">키워드 이름순</option><option value="total_desc">검색량 높은순</option><option value="total_asc">검색량 낮은순</option><option value="documents_asc">문서수 적은순</option><option value="saturation_asc">포화도 낮은순</option></select></label></form>
   <div className={styles.tabs} role="group" aria-label="키워드 필터">{[...filters.map(([key,label])=>[key,label] as const),['personal','내가 추가'] as const,['unwritten','미작성'] as const].map(([filter,label])=><button key={filter} type="button" aria-pressed={query.filter===filter} disabled={busy} onClick={()=>load({filter})}>{label}</button>)}<button type="button" disabled={busy} onClick={()=>load({q:'',filter:'all',period:'all',category:'',sort:'newest'})}>조건 초기화</button></div>
   {list.data.length?<><div className={styles.tableScroll}><table><caption className={styles.srOnly}>조회 조건에 맞는 키워드와 측정 지표</caption><thead><tr><th>저장</th><th>키워드 / 분류</th><th>PC</th><th>모바일</th><th>월 검색량</th><th>문서수</th><th>포화도</th><th>시그널</th><th>작성 상태</th></tr></thead><tbody>{list.data.map(item=><KeywordRows key={item.id} item={item} favorite={favorite(item)} written={written(item)} signal={signal(item)} open={open===item.id} toggle={()=>setOpen(open===item.id?null:item.id)} detail={detail(item)}/>)}</tbody></table></div><div className={styles.cards}>{list.data.map(item=><article key={item.id} className={styles.card}><div className={styles.cardHeading}>{favorite(item)}<button type="button" className={styles.keyword} aria-expanded={open===item.id} onClick={()=>setOpen(open===item.id?null:item.id)}>{item.phrase}<small>{item.scope==='personal'?'내 키워드':'공개 추천'} · {item.category||'미분류'}</small></button>{signal(item)}</div><dl><div><dt>월 검색량</dt><dd>{number(item.total)}</dd></div><div><dt>문서수</dt><dd>{number(item.documentCount)}</dd></div><div><dt>포화도</dt><dd>{item.saturation===null?'—':`${item.saturation}배`}</dd></div></dl><div className={styles.cardActions}>{written(item)}<a href={`/dashboard/write?keyword=${encodeURIComponent(item.phrase)}`}>글쓰기 ↗</a></div>{detail(item)}</article>)}</div></>:<div className={styles.empty}><strong>{query.q||query.filter!=='all'||query.category||query.period!=='all'?'조건에 맞는 키워드가 없습니다.':'아직 키워드가 없습니다.'}</strong><p>위에서 키워드를 추가하거나 검색 조건을 바꿔보세요.</p></div>}
   <nav className={styles.pager} aria-label="키워드 목록 페이지"><span>총 {number(list.pagination.total)}개 · {list.pagination.page} / {pages} 페이지</span><button type="button" disabled={busy||list.pagination.page<=1} onClick={()=>load({page:list.pagination.page-1})}>이전</button><button type="button" disabled={busy||list.pagination.page>=pages} onClick={()=>load({page:list.pagination.page+1})}>다음</button></nav>
   <details className={styles.explain}><summary>지표와 추천 기준 안내</summary><p>월 검색량은 PC와 모바일의 합계, 포화도는 문서수를 월 검색량으로 나눈 값입니다. 황금 키워드는 검색량 1,000 이상·포화도 1 미만, 선점 기회는 황금을 제외한 검색량 300 이상·포화도 3 미만입니다. 이 앱의 분류 기준이며 검색 순위를 보장하지 않습니다.</p><p>—는 아직 측정하지 않은 값입니다. 검색량 조회가 연결되면 내 키워드 상세에서 지표를 수집할 수 있습니다. 개인 키워드는 500개까지 보관할 수 있습니다.</p></details>
  </section>
 </div>;
}

function KeywordRows({item,favorite,written,signal,open,toggle,detail}:{item:Recommendation;favorite:React.ReactNode;written:React.ReactNode;signal:React.ReactNode;open:boolean;toggle:()=>void;detail:React.ReactNode}){
 return <><tr data-keyword-id={item.id}><td>{favorite}</td><td><button type="button" className={styles.keyword} aria-expanded={open} onClick={toggle}>{item.phrase}<small>{item.scope==='personal'?'내 키워드':'공개 추천'} · {item.category||'미분류'} · {date(item.recommendedAt)} {item.note?'· 메모 있음':''}</small></button></td><td>{number(item.pcVolume)}</td><td>{number(item.mobileVolume)}</td><td><strong>{number(item.total)}</strong></td><td>{number(item.documentCount)}</td><td>{item.saturation===null?'—':`${item.saturation}배`}</td><td>{signal}</td><td>{written}</td></tr>{detail&&<tr><td colSpan={9} className={styles.detailCell}>{detail}</td></tr>}</>;
}
