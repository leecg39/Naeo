import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';
import {kstDayStart} from '../jobs/queue';
import {naverPostRef} from '../citations/match';
import {blogSearch,naverSearchConfig,type BlogItem,type NaverSearchConfig} from './naver-search';

/**
 * 새 규칙(원본 미확인): 키워드당 블로그 탭 상위 20개를 '정확도(sim)' 순으로 확인하고
 * 회원당 하루(KST) 10회까지. 실패한 호출은 기록하지 않아 한도를 소비하지 않는다.
 */
export const EXPOSURE_RESULTS=20,EXPOSURE_DAILY_LIMIT=10,EXPOSURE_KEPT=50;
export type ExposureHit={rank:number;naverId:string|null;title:string;link:string;postDate:string;kind:'mine'|'competitor'|'other'};
export type Exposure={id:string;keyword:string;total:number;hits:ExposureHit[];checkedAt:number;createdAt:number};
type Row={id:string;owner_id:string;keyword:string;total:number;results_json:string;checked_at:number;created_at:number};
const SELECT='SELECT id,owner_id,keyword,total,results_json,checked_at,created_at FROM keyword_exposures';
const toExposure=(r:Row):Exposure=>({id:r.id,keyword:r.keyword,total:r.total,hits:JSON.parse(r.results_json) as ExposureHit[],checkedAt:r.checked_at,createdAt:r.created_at});

const checkInput=z.object({keyword:z.string().trim().min(1).max(60)}).strict();
const listInput=z.object({keyword:z.string().trim().max(60).optional()}).strict();

export function remainingExposuresToday(db:Database,ownerId:string,now=Date.now()){
 const {n}=db.prepare('SELECT count(*) AS n FROM keyword_exposures WHERE owner_id=? AND created_at>=?').get(ownerId,kstDayStart(now)) as {n:number};
 return Math.max(0,EXPOSURE_DAILY_LIMIT-n);
}
export function listExposures(db:Database,ownerId:string,query:unknown={}):Exposure[]{
 const v=listInput.parse(query);
 const rows=v.keyword
  ?db.prepare(`${SELECT} WHERE owner_id=? AND keyword=? ORDER BY checked_at DESC,rowid DESC LIMIT ${EXPOSURE_KEPT}`).all(ownerId,v.keyword)
  :db.prepare(`${SELECT} WHERE owner_id=? ORDER BY checked_at DESC,rowid DESC LIMIT ${EXPOSURE_KEPT}`).all(ownerId);
 return (rows as Row[]).map(toExposure);
}
export function getExposure(db:Database,ownerId:string,id:string):Exposure{
 const r=/^[a-f0-9-]{36}$/.test(id)?db.prepare(`${SELECT} WHERE id=? AND owner_id=?`).get(id,ownerId) as Row|undefined:undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','상위 노출 확인을 찾을 수 없습니다.');
 return toExposure(r);
}

/** 내 블로그·등록한 경쟁 블로그를 결과에 표시한다. */
function mark(hits:BlogItem[],mine:Set<string>,competitors:Map<string,string>):ExposureHit[]{
 return hits.map((h,i)=>{
  const ref=naverPostRef(h.link)??naverPostRef(h.bloggerLink);
  const id=ref?.naverId.toLowerCase()??null;
  return{rank:i+1,naverId:id,title:h.title,link:h.link,postDate:h.postDate,kind:id&&mine.has(id)?'mine':id&&competitors.has(id)?'competitor':'other'};
 });
}

/** 키워드 상위 노출 확인. 호출·표시·저장을 한 요청에서 끝내고 실패 시 아무것도 남기지 않는다. */
export async function checkExposure(db:Database,ownerId:string,input:unknown,{config,fetchImpl}:{config?:NaverSearchConfig|null;fetchImpl?:import('../generation/provider').FetchLike}={},now=Date.now()):Promise<Exposure>{
 const v=checkInput.parse(input);
 const cfg=config===undefined?naverSearchConfig():config;
 if(!cfg)throw new AppError(503,'SEARCH_NOT_CONFIGURED','네이버 검색 API가 설정되지 않았습니다(미설정).');
 transaction(db,()=>{
  if(remainingExposuresToday(db,ownerId,now)<=0)throw new AppError(429,'EXPOSURE_QUOTA_EXCEEDED',`상위 노출 확인은 하루 ${EXPOSURE_DAILY_LIMIT}회까지입니다. 내일 0시(한국 시간)에 다시 채워집니다.`);
 });
 const found=await blogSearch(cfg,v.keyword,{display:EXPOSURE_RESULTS},fetchImpl);
 return transaction(db,()=>{
  if(remainingExposuresToday(db,ownerId,now)<=0)throw new AppError(429,'EXPOSURE_QUOTA_EXCEEDED',`상위 노출 확인은 하루 ${EXPOSURE_DAILY_LIMIT}회까지입니다. 내일 0시(한국 시간)에 다시 채워집니다.`);
  const mine=new Set((db.prepare('SELECT naver_id FROM blogs WHERE owner_id=?').all(ownerId) as {naver_id:string}[]).map(b=>b.naver_id.toLowerCase()));
  const competitors=new Map((db.prepare('SELECT naver_id,id FROM competitor_blogs WHERE owner_id=?').all(ownerId) as {naver_id:string;id:string}[]).map(c=>[c.naver_id.toLowerCase(),c.id]));
  const hits=mark(found.items,mine,competitors);
  const id=randomUUID();
  db.prepare('INSERT INTO keyword_exposures(id,owner_id,keyword,total,results_json,checked_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id,ownerId,v.keyword,found.total,JSON.stringify(hits),now,now);
  return toExposure(db.prepare(`${SELECT} WHERE id=?`).get(id) as Row);
 });
}
