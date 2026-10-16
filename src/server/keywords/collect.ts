import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {ProviderError,type FetchLike} from '../generation/provider';
import {rateLimit} from '../http';
import {KEYWORD_SELECT,type Keyword} from './records';
import {keywordStats,normalizePhrase,searchAdConfig,type KeywordStat,type SearchAdConfig} from './searchad';
import {blogSearch,naverSearchConfig,type NaverSearchConfig} from '../competitors/naver-search';

/** 새 규칙(원본 미확인): 한 요청에 최대 50개 키워드를 5개씩 묶어 조회하고, 문서수는 네이버 검색 총건수를 쓴다(미설정이면 직전 값 유지). */
export const COLLECT_BATCH=5,COLLECT_MAX=50;
const collectInput=z.object({keywordIds:z.array(z.uuid()).max(COLLECT_MAX).optional()}).strict();
type Target={id:string;phrase:string};

export type CollectResult={measured:{keywordId:string;phrase:string;pcVolume:number;mobileVolume:number;documentCount:number;compIdx:string}[];missing:string[];failed:{phrase:string;code:string}[];documents:'naver_search'|'kept'};

function targets(db:Database,ids:string[]|undefined):Target[]{
 if(ids?.length){
  const rows=ids.flatMap(id=>{const r=db.prepare(`${KEYWORD_SELECT} WHERE id=?`).get(id) as Keyword|undefined;return r?[{id:r.id,phrase:r.phrase}]:[];});
  const foundIds=new Set(rows.map(r=>r.id));
  if(ids.some(id=>!foundIds.has(id)))throw new AppError(404,'KEYWORD_NOT_FOUND','없는 키워드가 섞여 있습니다.');
  return rows;
 }
 return (db.prepare(`${KEYWORD_SELECT} WHERE status='active' ORDER BY created_at LIMIT ${COLLECT_MAX}`).all() as Keyword[]).map(k=>({id:k.id,phrase:k.phrase}));
}

const latestDocuments=(db:Database,keywordId:string)=>(db.prepare("SELECT document_count AS n FROM keyword_metrics WHERE keyword_id=? AND document_count>0 ORDER BY measured_at DESC,created_at DESC LIMIT 1").get(keywordId) as {n:number}|undefined)?.n??0;

/** 검색광고 API로 월간 검색량을, 설정된 경우 네이버 검색 총건수로 문서수를 채워 지표를 기록한다. */
export async function collectKeywordMetrics(db:Database,actorId:string,input:unknown,{searchAd,search,fetchImpl}:{searchAd?:SearchAdConfig|null;search?:NaverSearchConfig|null;fetchImpl?:FetchLike}={},now=Date.now()):Promise<CollectResult>{
 requireAdmin(userById(db,actorId));
 const v=collectInput.parse(input??{});
 const ads=searchAd===undefined?searchAdConfig():searchAd;
 if(!ads)throw new AppError(503,'SEARCHAD_NOT_CONFIGURED','네이버 검색광고 API가 설정되지 않았습니다(미설정).');
 rateLimit(db,`keyword-collect:${actorId}`,30,60*60_000,now);
 const list=targets(db,v.keywordIds);
 if(!list.length)throw new AppError(404,'KEYWORD_NOT_FOUND','지표를 수집할 키워드가 없습니다.');
 const naver=search===undefined?naverSearchConfig():search;
 const found=new Map<string,{target:Target;stat:KeywordStat}>();
 const failed:{phrase:string;code:string}[]=[];
 for(let i=0;i<list.length;i+=COLLECT_BATCH){
  const batch=list.slice(i,i+COLLECT_BATCH);
  try{
   const stats=await keywordStats(ads,batch.map(b=>b.phrase),fetchImpl);
   for(const t of batch){const stat=stats.get(normalizePhrase(t.phrase));if(stat)found.set(t.id,{target:t,stat});}
  }catch(e){
   const code=e instanceof ProviderError?e.code:'INTERNAL_ERROR';
   for(const t of batch)failed.push({phrase:t.phrase,code});
   if(e instanceof ProviderError&&!e.retryable&&['SEARCHAD_AUTH','SEARCHAD_REQUEST','SEARCHAD_NOT_FOUND'].includes(code)){
    for(const t of list.slice(i+COLLECT_BATCH))failed.push({phrase:t.phrase,code});
    break;
   }
  }
 }
 const measured:CollectResult['measured']=found.size?[...found.values()].map(({target:t,stat})=>({keywordId:t.id,phrase:t.phrase,pcVolume:stat.pcVolume,mobileVolume:stat.mobileVolume,documentCount:latestDocuments(db,t.id),compIdx:stat.compIdx})):[];
 // 문서수는 검색 API가 켜져 있을 때만 따로 조회한다(키워드당 1회, 실패 시 직전 값 유지).
 if(naver){
  for(const m of measured){
   try{m.documentCount=(await blogSearch(naver,m.phrase,{display:1},fetchImpl)).total;}
   catch{/* 직전 값 유지 */}
  }
 }
 transaction(db,()=>{
  for(const m of measured){
   db.prepare("INSERT INTO keyword_metrics(id,keyword_id,pc_volume,mobile_volume,document_count,source,measured_at,created_by,created_at) VALUES(?,?,?,?,?,'naver_searchad',?,?,?)")
    .run(randomUUID(),m.keywordId,m.pcVolume,m.mobileVolume,m.documentCount,now,actorId,now);
  }
  audit(db,actorId,'admin.keyword.metrics.collect','keyword','bulk',{keywords:measured.length,missing:list.length-found.size-failed.length,failed:failed.length});
 });
 return{measured,missing:list.filter(t=>!found.has(t.id)&&!failed.some(f=>f.phrase===t.phrase)).map(t=>t.phrase),failed,documents:naver?'naver_search':'kept'};
}
