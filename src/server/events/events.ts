import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput} from '../validation';
import {createEventInput,eventQueryInput,updateEventInput} from './validation';

export type EventStatus='draft'|'published'|'closed';
export type EventPhase='upcoming'|'open'|'ended';
export type EventItem={id:string;slug:string;title:string;summary:string;body:string;status:EventStatus;startsAt:number;endsAt:number;requiresProof:boolean;rewardTokens:number;acceptsEntries:boolean;ctaLabel:string;ctaHref:string;version:number;createdAt:number;updatedAt:number};
type Raw=Omit<EventItem,'requiresProof'|'acceptsEntries'>&{requiresProof:number;acceptsEntries:number};
export const EVENT_SELECT='SELECT id,slug,title,summary,body,status,starts_at AS startsAt,ends_at AS endsAt,requires_proof AS requiresProof,reward_tokens AS rewardTokens,accepts_entries AS acceptsEntries,cta_label AS ctaLabel,cta_href AS ctaHref,version,created_at AS createdAt,updated_at AS updatedAt FROM events';
const plain=(r:Raw):EventItem=>({...r,requiresProof:r.requiresProof===1,acceptsEntries:r.acceptsEntries===1});
const COLUMNS={slug:'slug',title:'title',summary:'summary',body:'body',status:'status',startsAt:'starts_at',endsAt:'ends_at',requiresProof:'requires_proof',rewardTokens:'reward_tokens',acceptsEntries:'accepts_entries',ctaLabel:'cta_label',ctaHref:'cta_href'} as const;
type Field=keyof typeof COLUMNS;
const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));

/** 진행 단계: 마감(closed)이거나 종료 시각이 지나면 종료, 시작 전이면 예정. */
export const phaseOf=(e:Pick<EventItem,'status'|'startsAt'|'endsAt'>,now:number):EventPhase=>
 e.status==='closed'||now>=e.endsAt?'ended':now<e.startsAt?'upcoming':'open';

export function eventById(db:Database,id:string):EventItem{
 const r=db.prepare(`${EVENT_SELECT} WHERE id=?`).get(id) as Raw|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','이벤트를 찾을 수 없습니다.');
 return plain(r);
}
export function eventBySlug(db:Database,slug:string):EventItem|null{
 const r=db.prepare(`${EVENT_SELECT} WHERE slug=?`).get(slug) as Raw|undefined;
 return r?plain(r):null;
}
function assertVersion(current:{version:number},expected:number){
 if(current.version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
}
function assertSlugFree(db:Database,slug:string,id:string){
 if(db.prepare('SELECT 1 FROM events WHERE slug=? AND id<>?').get(slug,id))throw new AppError(409,'SLUG_EXISTS','이미 사용 중인 주소입니다.');
}

/** 공개 목록: 게시·마감된 이벤트(초안 제외). 진행 중 → 예정 → 종료 순, 같은 단계는 최근 시작 순. */
export function listPublicEvents(db:Database,now=Date.now()){
 const rows=(db.prepare(`${EVENT_SELECT} WHERE status IN ('published','closed') ORDER BY starts_at DESC`).all() as Raw[]).map(plain);
 const order:Record<EventPhase,number>={open:0,upcoming:1,ended:2};
 return rows.map(e=>({...e,phase:phaseOf(e,now)})).sort((a,b)=>order[a.phase]-order[b.phase]);
}
export function getPublicEvent(db:Database,slug:string,now=Date.now()){
 const e=eventBySlug(db,slug);
 if(!e||e.status==='draft')return null;
 const entries=(db.prepare("SELECT count(*) AS n FROM event_entries WHERE event_id=? AND status<>'withdrawn'").get(e.id) as {n:number}).n;
 return{...e,phase:phaseOf(e,now),entries};
}

export function listAdminEvents(db:Database,actorId:string,query:unknown,now=Date.now()){
 authorize(db,actorId);
 const {page,pageSize,q,status,acceptsEntries}=eventQueryInput.parse(query);
 const like=`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;
 const where=["(title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\')"],params:(string|number)[]=[like,like];
 if(status){where.push('status=?');params.push(status);}
 if(acceptsEntries!==undefined){where.push('accepts_entries=?');params.push(acceptsEntries==='true'?1:0);}
 const sql=`WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total FROM events ${sql}`).get(...params) as {total:number};
 const rows=(db.prepare(`${EVENT_SELECT} ${sql} ORDER BY starts_at DESC,created_at DESC,id LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as Raw[]).map(plain);
 const counts=db.prepare("SELECT status,count(*) AS n FROM event_entries WHERE event_id=? GROUP BY status");
 const data=rows.map(e=>({...e,phase:phaseOf(e,now),entryCounts:Object.fromEntries((counts.all(e.id) as {status:string;n:number}[]).map(c=>[c.status,c.n]))}));
 return{data,pagination:{page,pageSize,total}};
}

export function createEvent(db:Database,actorId:string,input:unknown):EventItem{
 authorize(db,actorId);
 const v=createEventInput.parse(input);
 const id=randomUUID(),now=Date.now();
 return transaction(db,()=>{
  assertSlugFree(db,v.slug,id);
  db.prepare('INSERT INTO events(id,slug,title,summary,body,status,starts_at,ends_at,requires_proof,reward_tokens,accepts_entries,cta_label,cta_href,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(id,v.slug,v.title,v.summary,v.body,v.status,v.startsAt,v.endsAt,v.requiresProof?1:0,v.rewardTokens,v.acceptsEntries?1:0,v.ctaLabel,v.ctaHref,actorId,actorId,now,now);
  audit(db,actorId,'admin.event.create','event',id,{slug:v.slug,status:v.status});
  return eventById(db,id);
 });
}

export function updateEvent(db:Database,actorId:string,id:string,input:unknown):EventItem{
 authorize(db,actorId);
 const {version,...changes}=updateEventInput.parse(input);
 return transaction(db,()=>{
  const current=eventById(db,id);
  assertVersion(current,version);
  if(changes.slug)assertSlugFree(db,changes.slug,id);
  if((changes.endsAt??current.endsAt)<=(changes.startsAt??current.startsAt))throw new AppError(400,'INVALID_PERIOD','종료 시각은 시작 시각보다 늦어야 합니다.');
  const keys=Object.keys(changes) as Field[];
  const value=(k:Field)=>{const x=changes[k];return typeof x==='boolean'?(x?1:0):x as string|number;};
  db.prepare(`UPDATE events SET ${keys.map(k=>COLUMNS[k]+'=?').join(',')},version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=?`)
   .run(...keys.map(value),actorId,Date.now(),id,version);
  audit(db,actorId,'admin.event.update','event',id,{fields:keys});
  return eventById(db,id);
 });
}

/** 참여 기록이 있는 이벤트는 지우지 않고 마감(closed)하도록 한다(리워드·심사 이력 보존). */
export function deleteEvent(db:Database,actorId:string,id:string,input:unknown){
 authorize(db,actorId);
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  assertVersion(eventById(db,id),version);
  if(db.prepare('SELECT 1 FROM event_entries WHERE event_id=?').get(id))throw new AppError(409,'EVENT_HAS_ENTRIES','참여 기록이 있는 이벤트는 삭제할 수 없습니다. 마감으로 바꿔주세요.');
  db.prepare('DELETE FROM events WHERE id=? AND version=?').run(id,version);
  audit(db,actorId,'admin.event.delete','event',id);
  return{deleted:true};
 });
}
