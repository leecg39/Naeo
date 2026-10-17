import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';
import {rateLimit} from '../http';
import {autoKeyword} from '../citations/keywords';
import {ProviderError,type FetchLike} from '../generation/provider';
import {blogSearch,naverSearchConfig,type NaverSearchConfig} from '../competitors/naver-search';
import {keywordStats,normalizePhrase,searchAdConfig,type SearchAdConfig} from './searchad';
import {getRecommendation,phraseKey,recommendationRows} from './recommendations';

const phrase=z.string().transform(s=>s.normalize('NFKC').replace(/\s+/g,' ').trim()).pipe(z.string().min(1,'키워드를 입력해주세요.').max(60));
const category=z.string().trim().max(30),note=z.string().trim().max(500);
const createInput=z.object({phrase,category:category.default(''),note:note.default(''),favorite:z.boolean().default(false)}).strict();
const updateInput=z.object({phrase:phrase.optional(),category:category.optional(),note:note.optional(),favorite:z.boolean().optional(),written:z.boolean().optional(),version:z.number().int().min(0)}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
const versionInput=z.object({version:z.number().int().min(1)}).strict();
export const MEMBER_KEYWORD_LIMIT=500;
function assertFree(db:Database,userId:string,value:string,except=''){
 if(db.prepare('SELECT 1 FROM member_keywords WHERE owner_id=? AND phrase_key=? AND id<>?').get(userId,phraseKey(value),except))throw new AppError(409,'KEYWORD_EXISTS','이미 추가한 키워드입니다. 검색해서 확인해주세요.');
}
export function createMemberKeyword(db:Database,userId:string,input:unknown,now=Date.now()){
 const v=createInput.parse(input);
 return transaction(db,()=>{
  assertFree(db,userId,v.phrase);
  if((db.prepare('SELECT count(*) AS n FROM member_keywords WHERE owner_id=?').get(userId) as {n:number}).n>=MEMBER_KEYWORD_LIMIT)throw new AppError(409,'KEYWORD_LIMIT',`내 키워드는 ${MEMBER_KEYWORD_LIMIT}개까지 보관할 수 있습니다.`);
  const id=randomUUID();
  db.prepare('INSERT INTO member_keywords(id,owner_id,phrase,phrase_key,category,note,favorite,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,userId,v.phrase,phraseKey(v.phrase),v.category,v.note,Number(v.favorite),now,now);
  return getRecommendation(db,userId,id);
 });
}
export function updateMemberKeyword(db:Database,userId:string,id:string,input:unknown,now=Date.now()){
 const v=updateInput.parse(input);
 return transaction(db,()=>{
  const current=getRecommendation(db,userId,id);
  if(current.version!==v.version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 수정한 키워드입니다. 목록을 새로고침해주세요.');
  if(current.scope==='personal'){
   const nextPhrase=v.phrase??current.phrase;assertFree(db,userId,nextPhrase,id);
   const renamed=phraseKey(nextPhrase)!==phraseKey(current.phrase);
   db.prepare('UPDATE member_keywords SET phrase=?,phrase_key=?,category=?,note=?,favorite=?,written=?,version=version+1,updated_at=?,pc_volume=?,mobile_volume=?,document_count=?,measured_at=? WHERE id=? AND owner_id=?')
    .run(nextPhrase,phraseKey(nextPhrase),v.category??current.category,v.note??current.note,Number(v.favorite??current.favorite),Number(v.written??current.written),now,renamed?null:current.pcVolume,renamed?null:current.mobileVolume,renamed?null:current.documentCount,renamed?null:current.measuredAt,id,userId);
  }else{
   if(v.phrase!==undefined||v.category!==undefined)throw new AppError(400,'CATALOG_READ_ONLY','추천 키워드 이름과 분류는 관리자가 수정할 수 있습니다.');
   db.prepare(`INSERT INTO saved_keywords(id,owner_id,keyword_id,status,favorite,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(owner_id,keyword_id) DO UPDATE SET status=excluded.status,favorite=excluded.favorite,note=excluded.note,version=version+1,updated_at=excluded.updated_at`)
    .run(randomUUID(),userId,id,(v.written??current.written)?'written':'saved',Number(v.favorite??current.favorite),v.note??current.note,now,now);
  }
  return getRecommendation(db,userId,id);
 });
}
export function deleteMemberKeyword(db:Database,userId:string,id:string,input:unknown){
 const {version}=versionInput.parse(input);
 return transaction(db,()=>{
  const current=getRecommendation(db,userId,id);
  if(current.scope!=='personal')throw new AppError(400,'CATALOG_READ_ONLY','공개 추천 키워드는 삭제할 수 없습니다. 즐겨찾기를 해제해주세요.');
  if(current.version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 수정한 키워드입니다. 목록을 새로고침해주세요.');
  db.prepare('DELETE FROM member_keywords WHERE owner_id=? AND id=?').run(userId,id);
  return{deleted:true};
 });
}

export type KeywordSuggestion={phrase:string;category:string;postTitle:string;postCount:number};
/** 본인 블로그에서 수집한 최근 글의 태그·제목만 사용한다. 검색량이나 기회 등급을 추정하지 않는다. */
export function keywordSuggestions(db:Database,userId:string):KeywordSuggestion[]{
 const posts=db.prepare('SELECT p.title,p.tags_json,p.category FROM blog_posts p JOIN blogs b ON b.id=p.blog_id WHERE b.owner_id=? ORDER BY p.published_at DESC,p.collected_at DESC,p.id LIMIT 200').all(userId) as {title:string;tags_json:string;category:string}[];
 const existing=new Set(recommendationRows(db,userId).map(r=>phraseKey(r.phrase))),found=new Map<string,KeywordSuggestion>();
 for(const p of posts){
  const tags=JSON.parse(p.tags_json) as string[];
  const candidates=[...tags.slice(0,5),autoKeyword(p.title,[])?.keyword??''].map(s=>s.replace(/^#+/,'').normalize('NFKC').replace(/\s+/g,' ').trim()).filter(s=>s.length>=2&&s.length<=60);
  for(const key of new Set(candidates.map(phraseKey))){
   if(existing.has(key))continue;
   const value=found.get(key);if(value){value.postCount++;continue;}
   found.set(key,{phrase:candidates.find(s=>phraseKey(s)===key)!,category:p.category.slice(0,30),postTitle:p.title.slice(0,150),postCount:1});
  }
 }
 return [...found.values()].sort((a,b)=>b.postCount-a.postCount||a.phrase.localeCompare(b.phrase,'ko')).slice(0,12);
}

/** 회원 본인의 키워드만 측정한다. 문서수 조회 실패/미설정은 null이며 황금 키워드로 분류하지 않는다. */
export async function measureMemberKeyword(db:Database,userId:string,id:string,input:unknown,{ads,search,fetchImpl}:{ads?:SearchAdConfig|null;search?:NaverSearchConfig|null;fetchImpl?:FetchLike}={},now=Date.now()){
 const {version}=versionInput.parse(input),current=getRecommendation(db,userId,id);
 if(current.scope!=='personal')throw new AppError(400,'CATALOG_READ_ONLY','공개 추천 지표는 관리자 수집으로 갱신됩니다.');
 if(current.version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 수정한 키워드입니다. 목록을 새로고침해주세요.');
 const config=ads===undefined?searchAdConfig():ads;
 if(!config)throw new AppError(503,'SEARCHAD_NOT_CONFIGURED','검색량 조회가 아직 연결되지 않았습니다. 키워드 보관과 글쓰기는 사용할 수 있습니다.');
 rateLimit(db,`member-keyword-metrics:${userId}`,20,3600000,now);
 let volumes;
 try{volumes=(await keywordStats(config,[current.phrase],fetchImpl)).get(normalizePhrase(current.phrase));}
 catch(e){if(e instanceof ProviderError)throw new AppError(502,e.code,e.message);throw e;}
 if(!volumes)throw new AppError(404,'KEYWORD_METRIC_MISSING','이 키워드의 검색량 자료를 찾지 못했습니다. 기존 지표는 유지했습니다.');
 const searchConfig=search===undefined?naverSearchConfig():search;
 let documentCount:number|null=null;
 if(searchConfig)try{documentCount=(await blogSearch(searchConfig,current.phrase,{display:1},fetchImpl)).total;}catch{/* 확인하지 못한 문서수는 0으로 표시하지 않는다. */}
 return transaction(db,()=>{
  const latest=getRecommendation(db,userId,id);
  if(latest.version!==version)throw new AppError(409,'VERSION_CONFLICT','조회 중 키워드가 변경되었습니다. 다시 조회해주세요.');
  db.prepare('UPDATE member_keywords SET pc_volume=?,mobile_volume=?,document_count=?,measured_at=?,updated_at=?,version=version+1 WHERE owner_id=? AND id=?').run(volumes.pcVolume,volumes.mobileVolume,documentCount,now,now,userId,id);
  return getRecommendation(db,userId,id);
 });
}
