import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Database} from '../database';
import {AppError} from '../errors';
import {paginationInput} from '../validation';
import {classify,likeOf,type Classification} from './records';
export {classify} from './records';

const DAY=86_400_000;
const queryInput=paginationInput.extend({filter:z.enum(['all','golden','preempt','written']).default('all'),period:z.enum(['all','week','month']).default('all')});
const stateInput=z.object({status:z.enum(['saved','written']).nullable(),note:z.string().trim().max(500).optional()}).strict();
export type Recommendation=Classification&{id:string;phrase:string;category:string;recommendedAt:number;pcVolume:number|null;mobileVolume:number|null;documentCount:number|null;measuredAt:number|null;source:string|null;state:'saved'|'written'|null};
type Row={id:string;phrase:string;category:string;created_at:number;pc_volume:number|null;mobile_volume:number|null;document_count:number|null;measured_at:number|null;source:string|null;state:'saved'|'written'|null};

/** 공개 키워드 + 최신 지표 + 이 회원의 상태. */
function rows(db:Database,userId:string,q:string,since:number):Recommendation[]{
 const list=db.prepare(`SELECT k.id,k.phrase,k.category,k.created_at,m.pc_volume,m.mobile_volume,m.document_count,m.measured_at,m.source,s.status AS state
  FROM keywords k
  LEFT JOIN keyword_metrics m ON m.id=(SELECT id FROM keyword_metrics WHERE keyword_id=k.id ORDER BY measured_at DESC,created_at DESC LIMIT 1)
  LEFT JOIN saved_keywords s ON s.keyword_id=k.id AND s.owner_id=?
  WHERE k.status='active' AND k.created_at>=? AND (k.phrase LIKE ? ESCAPE '\\' OR k.category LIKE ? ESCAPE '\\')
  ORDER BY k.created_at DESC,k.id`).all(userId,since,likeOf(q),likeOf(q)) as Row[];
 return list.map(r=>({...classify(r.pc_volume===null?null:{pcVolume:r.pc_volume,mobileVolume:r.mobile_volume!,documentCount:r.document_count!}),
  id:r.id,phrase:r.phrase,category:r.category,recommendedAt:r.created_at,pcVolume:r.pc_volume,mobileVolume:r.mobile_volume,documentCount:r.document_count,measuredAt:r.measured_at,source:r.source,state:r.state}));
}

export function listRecommendations(db:Database,userId:string,query:unknown,now=Date.now()){
 const {page,pageSize,q,filter,period}=queryInput.parse(query);
 const since=period==='week'?now-7*DAY:period==='month'?now-30*DAY:0;
 const all=rows(db,userId,q,since);
 const summary={total:all.length,golden:all.filter(r=>r.golden).length,preempt:all.filter(r=>r.preempt).length,written:all.filter(r=>r.state==='written').length};
 const filtered=all.filter(r=>filter==='all'||(filter==='golden'&&r.golden)||(filter==='preempt'&&r.preempt)||(filter==='written'&&r.state==='written'));
 return{data:filtered.slice((page-1)*pageSize,page*pageSize),pagination:{page,pageSize,total:filtered.length},summary};
}

/** 작성 완료·저장 표시를 바꾸거나(status) 해제한다(status:null). 공개 키워드만 가능. */
export function setKeywordState(db:Database,userId:string,keywordId:string,input:unknown){
 const v=stateInput.parse(input);
 if(!db.prepare("SELECT 1 FROM keywords WHERE id=? AND status='active'").get(keywordId))throw new AppError(404,'NOT_FOUND','키워드를 찾을 수 없습니다.');
 const now=Date.now();
 if(v.status===null){db.prepare('DELETE FROM saved_keywords WHERE owner_id=? AND keyword_id=?').run(userId,keywordId);return{keywordId,status:null};}
 db.prepare(`INSERT INTO saved_keywords(id,owner_id,keyword_id,status,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
  ON CONFLICT(owner_id,keyword_id) DO UPDATE SET status=excluded.status,note=coalesce(?,note),version=version+1,updated_at=excluded.updated_at`)
  .run(randomUUID(),userId,keywordId,v.status,v.note??'',now,now,v.note??null);
 return{keywordId,status:v.status};
}
