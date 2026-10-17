import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Database} from '../database';
import {AppError} from '../errors';
import {paginationInput} from '../validation';
import {classify,type Classification} from './records';
export {classify} from './records';

const DAY=86_400_000;
export const recommendationQuery=paginationInput.extend({
 filter:z.enum(['all','golden','preempt','saved','written','unwritten','personal']).default('all'),
 period:z.enum(['all','week','month']).default('all'),category:z.string().trim().max(30).default(''),
 sort:z.enum(['newest','phrase','total_desc','total_asc','documents_asc','saturation_asc']).default('newest')
});
export type RecommendationQuery=z.infer<typeof recommendationQuery>;
const stateInput=z.object({status:z.enum(['saved','written']).nullable(),note:z.string().trim().max(500).optional()}).strict();
export const phraseKey=(value:string)=>value.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
export type Recommendation=Classification&{id:string;phrase:string;category:string;recommendedAt:number;pcVolume:number|null;mobileVolume:number|null;documentCount:number|null;measuredAt:number|null;source:string|null;state:'saved'|'written'|null;scope:'catalog'|'personal';favorite:boolean;written:boolean;note:string;version:number};
type Row={id:string;phrase:string;category:string;created_at:number;pc_volume:number|null;mobile_volume:number|null;document_count:number|null;measured_at:number|null;source:string|null;favorite:number;written:number;note:string;version:number;scope:'catalog'|'personal'};

/** 공개 목록과 본인의 개인 키워드만 합친다. 개인 키워드는 다른 회원에게 공개하지 않는다. */
export function recommendationRows(db:Database,userId:string):Recommendation[]{
 const publicRows=db.prepare(`SELECT k.id,k.phrase,k.category,k.created_at,m.pc_volume,m.mobile_volume,m.document_count,m.measured_at,m.source,
  coalesce(s.favorite,0) AS favorite,coalesce(s.status='written',0) AS written,coalesce(s.note,'') AS note,coalesce(s.version,0) AS version,'catalog' AS scope
  FROM keywords k
  LEFT JOIN keyword_metrics m ON m.id=(SELECT id FROM keyword_metrics WHERE keyword_id=k.id ORDER BY measured_at DESC,created_at DESC,id LIMIT 1)
  LEFT JOIN saved_keywords s ON s.keyword_id=k.id AND s.owner_id=? WHERE k.status='active'`).all(userId) as Row[];
 const personal=db.prepare("SELECT id,phrase,category,created_at,pc_volume,mobile_volume,document_count,measured_at,CASE WHEN measured_at IS NULL THEN NULL ELSE 'naver_searchad' END AS source,favorite,written,note,version,'personal' AS scope FROM member_keywords WHERE owner_id=?").all(userId) as Row[];
 const privateKeys=new Set(personal.map(r=>phraseKey(r.phrase)));
 return [...publicRows.filter(r=>!privateKeys.has(phraseKey(r.phrase))),...personal].map(r=>({
  ...classify(r.pc_volume===null||r.mobile_volume===null?null:{pcVolume:r.pc_volume,mobileVolume:r.mobile_volume,documentCount:r.document_count}),
  id:r.id,phrase:r.phrase,category:r.category,recommendedAt:r.created_at,pcVolume:r.pc_volume,mobileVolume:r.mobile_volume,documentCount:r.document_count,measuredAt:r.measured_at,source:r.source,
  scope:r.scope,favorite:!!r.favorite,written:!!r.written,note:r.note,version:r.version,state:r.written?'written':r.favorite?'saved':null
 }));
}
export function getRecommendation(db:Database,userId:string,id:string):Recommendation{
 const record=recommendationRows(db,userId).find(r=>r.id===id);
 if(!record)throw new AppError(404,'NOT_FOUND','키워드를 찾을 수 없습니다.');
 return record;
}

export function listRecommendations(db:Database,userId:string,input:unknown,now=Date.now()){
 const query=recommendationQuery.parse(input),{pageSize,q,filter,period,category,sort}=query;
 const since=period==='week'?now-7*DAY:period==='month'?now-30*DAY:0;
 const rows=recommendationRows(db,userId),term=q.toLocaleLowerCase();
 const categories=[...new Set(rows.map(r=>r.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
 const all=rows.filter(r=>r.recommendedAt>=since&&r.recommendedAt<=now&&(!category||r.category===category)&&`${r.phrase}\n${r.category}`.toLocaleLowerCase().includes(term));
 const summary={total:all.length,golden:all.filter(r=>r.golden).length,preempt:all.filter(r=>r.preempt).length,written:all.filter(r=>r.written).length,saved:all.filter(r=>r.favorite).length,personal:all.filter(r=>r.scope==='personal').length};
 const filtered=all.filter(r=>filter==='all'||(filter==='golden'&&r.golden)||(filter==='preempt'&&r.preempt)||(filter==='written'&&r.written)||(filter==='unwritten'&&!r.written)||(filter==='saved'&&r.favorite)||(filter==='personal'&&r.scope==='personal'));
 const numberOrder=(a:number|null,b:number|null,ascending=true)=>a===null?(b===null?0:1):b===null?-1:(a-b)*(ascending?1:-1);
 filtered.sort((a,b)=>{
  const order=sort==='phrase'?a.phrase.localeCompare(b.phrase,'ko'):sort==='total_desc'?numberOrder(a.total,b.total,false):sort==='total_asc'?numberOrder(a.total,b.total):sort==='documents_asc'?numberOrder(a.documentCount,b.documentCount):sort==='saturation_asc'?numberOrder(a.saturation,b.saturation):b.recommendedAt-a.recommendedAt;
  return order||b.recommendedAt-a.recommendedAt||a.id.localeCompare(b.id);
 });
 const page=Math.min(query.page,Math.max(1,Math.ceil(filtered.length/pageSize)));
 return{data:filtered.slice((page-1)*pageSize,page*pageSize),pagination:{page,pageSize,total:filtered.length},summary,categories,query:{...query,page}};
}
export type RecommendationList=ReturnType<typeof listRecommendations>;

/** 기존 API 호환: saved는 즐겨찾기, written은 완료, null은 두 표시 해제. */
export function setKeywordState(db:Database,userId:string,keywordId:string,input:unknown){
 const v=stateInput.parse(input);
 if(!db.prepare("SELECT 1 FROM keywords WHERE id=? AND status='active'").get(keywordId))throw new AppError(404,'NOT_FOUND','키워드를 찾을 수 없습니다.');
 const now=Date.now();
 if(v.status===null){db.prepare('DELETE FROM saved_keywords WHERE owner_id=? AND keyword_id=?').run(userId,keywordId);return{keywordId,status:null};}
 db.prepare(`INSERT INTO saved_keywords(id,owner_id,keyword_id,status,favorite,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
  ON CONFLICT(owner_id,keyword_id) DO UPDATE SET status=excluded.status,favorite=CASE WHEN excluded.status='saved' THEN 1 ELSE favorite END,note=coalesce(?,note),version=version+1,updated_at=excluded.updated_at`)
  .run(randomUUID(),userId,keywordId,v.status,v.status==='saved'?1:0,v.note??'',now,now,v.note??null);
 return{keywordId,status:v.status};
}
