import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';
import {effectiveKeyword} from './keywords';
import {matchCitation} from './match';
import {CitationError,type CitationProvider,type SearchEvidence} from './provider';
import type {Evidence,RunRow} from './runs';

export const CITATION_LEASE_MS=5*60_000;
const backoff=(attempt:number)=>60_000*2**Math.max(0,attempt-1);
const leaseLost=()=>new AppError(409,'LEASE_LOST','다른 작업자가 이 작업을 가져갔습니다.');

function claim(db:Database,workerId:string,now:number):RunRow|null{
 return transaction(db,()=>{
  for(;;){
   const r=db.prepare("SELECT * FROM citation_runs WHERE (state='queued' AND run_after<=?) OR (state='running' AND lease_until<?) ORDER BY run_after,created_at LIMIT 1").get(now,now) as RunRow|undefined;
   if(!r)return null;
   if(r.cancel_requested===1||(r.state==='running'&&r.attempt>=r.max_attempts)){
    const canceled=r.cancel_requested===1;
    db.prepare("UPDATE citation_runs SET state=?,lease_owner=NULL,lease_until=NULL,error_code=?,error_message=?,completed_at=?,updated_at=? WHERE id=?")
     .run(canceled?'canceled':'failed',canceled?r.error_code:'LEASE_EXPIRED',canceled?r.error_message:'작업자가 응답하지 않아 확인을 마치지 못했습니다.',now,now,r.id);
    continue;
   }
   db.prepare("UPDATE citation_runs SET state='running',attempt=attempt+1,lease_owner=?,lease_until=?,updated_at=? WHERE id=?").run(workerId,now+CITATION_LEASE_MS,now,r.id);
   return db.prepare('SELECT * FROM citation_runs WHERE id=?').get(r.id) as RunRow;
  }
 });
}

type Post={id:string;external_id:string;title:string;tags_json:string};
const MAX_EVIDENCE=110_000;
/** 저장 한도(120,000자 CHECK)를 넘는 브리핑은 미리보기 이미지·요약문·본문 순으로 줄여 작업 전체가 실패하지 않게 한다. */
export function fitEvidence(evidence:Evidence):string{
 let json=JSON.stringify(evidence);
 const b=evidence.briefing;
 if(json.length<=MAX_EVIDENCE||!b)return json;
 const steps:((x:NonNullable<Evidence['briefing']>)=>NonNullable<Evidence['briefing']>)[]=[
  x=>({...x,media:x.media.map(m=>({...m,thumbnail:''}))}),
  x=>({...x,references:x.references.map(r=>({...r,snippet:''}))}),
  x=>({...x,markdown:x.markdown.slice(0,2000)}),
  x=>({...x,references:x.references.slice(0,5),media:x.media.slice(0,5)}),
 ];
 let current=b;
 for(const step of steps){current=step(current);json=JSON.stringify({...evidence,briefing:current});if(json.length<=MAX_EVIDENCE)return json;}
 return JSON.stringify({...evidence,briefing:{markdown:'',references:[],media:[],questions:[]}});
}
/** 결과 한 건 저장과 진행률·lease 연장을 함께 한다. lease를 잃었으면 아무것도 쓰지 않는다. */
function save(db:Database,run:RunRow,workerId:string,naverId:string,post:Post,keyword:{keyword:string;source:'member'|'tag'|'title'},outcome:SearchEvidence|CitationError,searches:number,progress:number,now:number){
 transaction(db,()=>{
  const lease=db.prepare("UPDATE citation_runs SET checked=checked+1,searches=searches+?,progress=?,lease_until=?,updated_at=? WHERE id=? AND state='running' AND lease_owner=?").run(searches,progress,now+CITATION_LEASE_MS,now,run.id,workerId);
  if(!lease.changes)throw leaseLost();
  if(outcome instanceof CitationError){
   const evidence:Evidence={briefing:null,exposure:null,searches,error:{code:outcome.code,message:outcome.message}};
   db.prepare("INSERT INTO citation_results(id,run_id,owner_id,blog_id,post_id,keyword,keyword_source,status,briefing,exposed,evidence_json,checked_at) VALUES(?,?,?,?,?,?,?,'error',0,0,?,?)").run(randomUUID(),run.id,run.owner_id,run.blog_id,post.id,keyword.keyword,keyword.source,fitEvidence(evidence),now);
   return;
  }
  const m=matchCitation(outcome,naverId,post.external_id);
  const evidence:Evidence={briefing:outcome.briefing,exposure:m.exposure,searches};
  db.prepare("INSERT INTO citation_results(id,run_id,owner_id,blog_id,post_id,keyword,keyword_source,status,briefing,exposed,text_rank,image_rank,evidence_json,checked_at) VALUES(?,?,?,?,?,?,?,'checked',?,?,?,?,?,?)")
   .run(randomUUID(),run.id,run.owner_id,run.blog_id,post.id,keyword.keyword,keyword.source,m.briefing?1:0,m.exposed?1:0,m.textRank,m.imageRank,fitEvidence(evidence),now);
 });
}
function finish(db:Database,id:string,workerId:string,now:number){
 db.prepare("UPDATE citation_runs SET state=CASE WHEN cancel_requested=1 THEN 'canceled' ELSE 'succeeded' END,progress=CASE WHEN cancel_requested=1 THEN progress ELSE 100 END,error_code=NULL,error_message=NULL,lease_owner=NULL,lease_until=NULL,completed_at=?,updated_at=? WHERE id=? AND state='running' AND lease_owner=?").run(now,now,id,workerId);
}
function cancelNow(db:Database,id:string,workerId:string,now:number){
 db.prepare("UPDATE citation_runs SET state='canceled',lease_owner=NULL,lease_until=NULL,completed_at=?,updated_at=? WHERE id=? AND state='running' AND lease_owner=?").run(now,now,id,workerId);
}
function fail(db:Database,id:string,workerId:string,e:unknown,now:number){
 const err=e as {code?:unknown;message?:unknown;retryable?:unknown};
 const code=typeof err.code==='string'?err.code.slice(0,60):'INTERNAL_ERROR';
 const message=(typeof err.message==='string'&&err.message?err.message:'AI 인용 확인 중 오류가 발생했습니다.').slice(0,500);
 // 공급자가 명시한 일시 오류와 알 수 없는 오류는 재시도하고, 인증·한도 같은 확정 오류는 바로 실패한다.
 const retryable=e instanceof CitationError?e.retryable:!(e instanceof AppError);
 transaction(db,()=>{
  const r=db.prepare("SELECT * FROM citation_runs WHERE id=? AND state='running' AND lease_owner=?").get(id,workerId) as RunRow|undefined;
  if(!r)return;
  if(retryable&&r.cancel_requested===0&&r.attempt<r.max_attempts){
   db.prepare("UPDATE citation_runs SET state='queued',run_after=?,error_code=?,error_message=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now+backoff(r.attempt),code,message,now,id);
   return;
  }
  db.prepare("UPDATE citation_runs SET state=?,error_code=?,error_message=?,lease_owner=NULL,lease_until=NULL,completed_at=?,updated_at=? WHERE id=?").run(r.cancel_requested===1?'canceled':'failed',code,message,now,now,id);
 });
}
const canceled=(db:Database,id:string)=>(db.prepare('SELECT cancel_requested FROM citation_runs WHERE id=?').get(id) as {cancel_requested:number}|undefined)?.cancel_requested!==0;

/**
 * 확인 작업 하나: 최근 글을 차례로 확인한다. 이미 저장한 글은 재시도 때 건너뛰고(공급자 비용 중복 방지),
 * 같은 작업 안의 같은 키워드는 한 번만 검색한다. 처리한 작업 id, 없으면 null.
 */
export async function runCitationOnce(db:Database,workerId:string,provider:CitationProvider|null,now:()=>number=Date.now):Promise<string|null>{
 const run=claim(db,workerId,now());
 if(!run)return null;
 try{
  if(!provider)throw new CitationError('CITATION_NOT_CONFIGURED','AI 인용 확인 공급자 설정이 해제되어 확인을 마치지 못했습니다.',false);
  const blog=db.prepare('SELECT naver_id FROM blogs WHERE id=? AND owner_id=?').get(run.blog_id,run.owner_id) as {naver_id:string}|undefined;
  if(!blog)throw leaseLost();
  const posts=db.prepare('SELECT id,external_id,title,tags_json FROM blog_posts WHERE blog_id=? ORDER BY published_at DESC,collected_at DESC,id LIMIT ?').all(run.blog_id,run.post_limit) as Post[];
  const done=new Set((db.prepare('SELECT post_id FROM citation_results WHERE run_id=?').all(run.id) as {post_id:string}[]).map(r=>r.post_id));
  const cache=new Map<string,SearchEvidence|CitationError>();
  let index=0;
  for(const post of posts){
   index++;
   if(done.has(post.id))continue;
   if(canceled(db,run.id)){cancelNow(db,run.id,workerId,now());return run.id;}
   const keyword=effectiveKeyword(db,run.owner_id,post);
   if(!keyword)continue;
   let outcome=cache.get(keyword.keyword),searches=0;
   if(!outcome){
    try{outcome=await provider(keyword.keyword);searches=outcome.searches;}
    catch(e){if(e instanceof CitationError&&e.scope==='query'){outcome=e;searches=1;}else throw e;}
    cache.set(keyword.keyword,outcome);
   }
   save(db,run,workerId,blog.naver_id,post,keyword,outcome,searches,Math.min(99,Math.round(index/Math.max(1,posts.length)*100)),now());
  }
  finish(db,run.id,workerId,now());
 }catch(e){
  if(e instanceof AppError&&e.code==='LEASE_LOST')return run.id;
  fail(db,run.id,workerId,e,now());
 }
 return run.id;
}
