import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput} from '../validation';
import {eventById,eventBySlug,phaseOf} from './events';
import {cancelReward,issueReward,rewardById} from './rewards';
import {entryQueryInput,parseProofUrl,reviewInput,submitEntryInput,updateEntryInput} from './validation';

export type EntryStatus='submitted'|'approved'|'rejected'|'withdrawn';
export type Entry={id:string;eventId:string;userId:string;proofUrl:string;note:string;status:EntryStatus;reviewNote:string;reviewedAt:number|null;version:number;createdAt:number;updatedAt:number};
const SELECT='SELECT id,event_id AS eventId,user_id AS userId,proof_url AS proofUrl,note,status,review_note AS reviewNote,reviewed_at AS reviewedAt,version,created_at AS createdAt,updated_at AS updatedAt FROM event_entries';

function entryById(db:Database,id:string):Entry{
 const r=db.prepare(`${SELECT} WHERE id=?`).get(id) as Entry|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','참여 기록을 찾을 수 없습니다.');
 return{...r};
}
function ownEntry(db:Database,userId:string,id:string):Entry{
 const e=entryById(db,id);
 if(e.userId!==userId)throw new AppError(404,'NOT_FOUND','참여 기록을 찾을 수 없습니다.');
 return e;
}
function assertVersion(current:{version:number},expected:number){
 if(current.version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 처리했습니다. 최신 내용을 불러와주세요.');
}
/** 인증 글은 내가 등록한 블로그의 글이어야 한다. 저장은 정규화한 주소로. */
function ownProof(db:Database,userId:string,raw:string):string{
 const p=parseProofUrl(raw)!;
 if(!db.prepare('SELECT 1 FROM blogs WHERE owner_id=? AND naver_id=?').get(userId,p.naverId))throw new AppError(400,'PROOF_NOT_OWN_BLOG','내가 등록한 블로그의 글만 인증할 수 있습니다. 설정에서 블로그를 먼저 등록해주세요.');
 return p.url;
}
function openEventOrThrow(db:Database,slug:string,now:number){
 const ev=eventBySlug(db,slug);
 if(!ev||ev.status==='draft')throw new AppError(404,'NOT_FOUND','이벤트를 찾을 수 없습니다.');
 if(!ev.acceptsEntries)throw new AppError(409,'ENTRIES_DISABLED','이 이벤트는 따로 참여 신청을 받지 않습니다.');
 if(phaseOf(ev,now)!=='open')throw new AppError(409,'EVENT_NOT_OPEN','참여 기간이 아닙니다.');
 return ev;
}

/** 이벤트 참여(회원당 한 건, 철회하면 다시 참여 가능). */
export function submitEntry(db:Database,userId:string,slug:string,input:unknown,now=Date.now()):Entry{
 const v=submitEntryInput.parse(input);
 return transaction(db,()=>{
  const ev=openEventOrThrow(db,slug,now);
  if(ev.requiresProof&&!v.proofUrl)throw new AppError(400,'PROOF_REQUIRED','인증할 블로그 글 주소를 입력해주세요.');
  const proof=v.proofUrl?ownProof(db,userId,v.proofUrl):'';
  if(db.prepare("SELECT 1 FROM event_entries WHERE event_id=? AND user_id=? AND status<>'withdrawn'").get(ev.id,userId))throw new AppError(409,'ALREADY_ENTERED','이미 참여한 이벤트입니다.');
  const id=randomUUID();
  db.prepare('INSERT INTO event_entries(id,event_id,user_id,proof_url,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,ev.id,userId,proof,v.note,now,now);
  audit(db,userId,'event.entry.submit','event_entry',id,{eventId:ev.id});
  return entryById(db,id);
 });
}

/** 심사 전(submitted)이고 이벤트가 진행 중일 때만 고칠 수 있다. */
export function updateMyEntry(db:Database,userId:string,id:string,input:unknown,now=Date.now()):Entry{
 const {version,...changes}=updateEntryInput.parse(input);
 return transaction(db,()=>{
  const e=ownEntry(db,userId,id);
  if(e.status!=='submitted')throw new AppError(409,'ENTRY_REVIEWED','심사가 끝났거나 철회한 참여는 고칠 수 없습니다.');
  assertVersion(e,version);
  if(phaseOf(eventById(db,e.eventId),now)!=='open')throw new AppError(409,'EVENT_NOT_OPEN','참여 기간이 끝났습니다.');
  const proof=changes.proofUrl!==undefined?ownProof(db,userId,changes.proofUrl):e.proofUrl;
  db.prepare('UPDATE event_entries SET proof_url=?,note=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(proof,changes.note??e.note,now,id,version);
  audit(db,userId,'event.entry.update','event_entry',id);
  return entryById(db,id);
 });
}
export function withdrawEntry(db:Database,userId:string,id:string,input:unknown,now=Date.now()):Entry{
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  const e=ownEntry(db,userId,id);
  if(e.status!=='submitted')throw new AppError(409,'ENTRY_REVIEWED','심사가 끝난 참여는 철회할 수 없습니다.');
  assertVersion(e,version);
  db.prepare("UPDATE event_entries SET status='withdrawn',version=version+1,updated_at=? WHERE id=? AND version=?").run(now,id,version);
  audit(db,userId,'event.entry.withdraw','event_entry',id);
  return entryById(db,id);
 });
}
export function listMyEntries(db:Database,userId:string,page=1){
 const {page:requested}=entryQueryInput.parse({page});
 const {total}=db.prepare('SELECT count(*) AS total FROM event_entries WHERE user_id=?').get(userId) as {total:number};
 const current=Math.min(requested,Math.max(1,Math.ceil(total/100)));
 const data=(db.prepare(`SELECT x.id,x.event_id AS eventId,e.slug,e.title,x.proof_url AS proofUrl,x.note,x.status,x.review_note AS reviewNote,x.reviewed_at AS reviewedAt,x.version,x.created_at AS createdAt,x.updated_at AS updatedAt
  FROM event_entries x JOIN events e ON e.id=x.event_id WHERE x.user_id=? ORDER BY x.created_at DESC,x.rowid DESC LIMIT 100 OFFSET ?`).all(userId,(current-1)*100) as (Entry&{slug:string;title:string})[]).map(r=>({...r}));
 return {data,pagination:{page:current,pageSize:100,total}};
}
export const myEntries=(db:Database,userId:string)=>listMyEntries(db,userId).data;

export function listEventEntries(db:Database,actorId:string,slug:string,query:unknown){
 requireAdmin(userById(db,actorId));
 const ev=eventBySlug(db,slug);
 if(!ev)throw new AppError(404,'NOT_FOUND','이벤트를 찾을 수 없습니다.');
 const {page,pageSize,q,status}=entryQueryInput.parse(query);
 const like=`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;
 const where=['x.event_id=?',"(u.email LIKE ? ESCAPE '\\' OR p.nickname LIKE ? ESCAPE '\\' OR x.proof_url LIKE ? ESCAPE '\\')"],params:(string|number)[]=[ev.id,like,like,like];
 if(status){where.push('x.status=?');params.push(status);}
 const from=`FROM event_entries x JOIN users u ON u.id=x.user_id LEFT JOIN profiles p ON p.user_id=x.user_id WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total ${from}`).get(...params) as {total:number};
 const rows=db.prepare(`SELECT x.id,x.event_id AS eventId,x.user_id AS userId,u.email AS ownerEmail,coalesce(p.nickname,'') AS ownerNickname,x.proof_url AS proofUrl,x.note,x.status,x.review_note AS reviewNote,x.reviewed_at AS reviewedAt,x.version,x.created_at AS createdAt,x.updated_at AS updatedAt
  ${from} ORDER BY x.created_at,x.rowid LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as (Entry&{ownerEmail:string;ownerNickname:string})[];
 return{event:ev,data:rows.map(r=>({...r})),pagination:{page,pageSize,total}};
}

/** 심사: 승인하면 이벤트 리워드 토큰을 한 번 지급, 승인을 뒤집으면 그 리워드를 회수한다. */
export function reviewEntry(db:Database,actorId:string,id:string,input:unknown,now=Date.now()):Entry{
 requireAdmin(userById(db,actorId));
 const v=reviewInput.parse(input);
 return transaction(db,()=>{
  const e=entryById(db,id);
  assertVersion(e,v.version);
  if(e.status==='withdrawn')throw new AppError(409,'ENTRY_WITHDRAWN','철회한 참여는 심사할 수 없습니다.');
  const ev=eventById(db,e.eventId);
  const sourceKey=`event:${e.id}`;
  const active=db.prepare("SELECT id FROM rewards WHERE source_key=? AND status='granted'").get(sourceKey) as {id:string}|undefined;
  if(v.decision==='rejected'&&active)cancelReward(db,rewardById(db,active.id),actorId,now);
  if(v.decision==='approved'&&!active&&ev.rewardTokens>0)issueReward(db,{userId:e.userId,kind:'event',tokens:ev.rewardTokens,description:`${ev.title} 참여 리워드`.slice(0,200),sourceKey,entryId:e.id,eventId:ev.id,actorId},now);
  db.prepare('UPDATE event_entries SET status=?,review_note=?,reviewed_by=?,reviewed_at=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(v.decision,v.note,actorId,now,now,id,v.version);
  audit(db,actorId,'admin.event.review','event_entry',id,{decision:v.decision});
  return entryById(db,id);
 });
}

/** 이 이벤트의 내 참여(철회 제외, 없으면 null). */
export function myEventEntry(db:Database,userId:string,slug:string):Entry|null{
 const r=db.prepare(`SELECT x.id FROM event_entries x JOIN events e ON e.id=x.event_id WHERE e.slug=? AND x.user_id=? AND x.status<>'withdrawn'`).get(slug,userId) as {id:string}|undefined;
 return r?entryById(db,r.id):null;
}
