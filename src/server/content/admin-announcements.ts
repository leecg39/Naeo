import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput} from '../validation';
import {ANNOUNCEMENT_SELECT,plainAnnouncement,type Announcement,type AnnouncementRow} from './announcements';
import {announcementConsistencyMessage,announcementConsistent,announcementQueryInput,createAnnouncementInput,updateAnnouncementInput} from './announcement-validation';
import {z} from 'zod';

const COLUMNS={metadata:'metadata',title:'title',body:'body',linkUrl:'link_url',linkLabel:'link_label',target:'target',startsAt:'starts_at',endsAt:'ends_at',status:'status'} as const;
type Field=keyof typeof COLUMNS;
const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));
const toMs=(v:string|null)=>v===null?null:Date.parse(v);
const iso=(ms:number|null)=>ms===null?null:new Date(ms).toISOString();
function row(db:Database,id:string):Announcement{
 const r=db.prepare(`${ANNOUNCEMENT_SELECT} WHERE id=?`).get(id) as AnnouncementRow|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','공지를 찾을 수 없습니다.');
 return plainAnnouncement(r);
}

export function listAdminAnnouncements(db:Database,actorId:string,query:unknown){
 authorize(db,actorId);
 const {page,pageSize,q,status}=announcementQueryInput.parse(query);
 const like=`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;
 const where=["(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')"],params:(string|number)[]=[like,like];
 if(status){where.push('status=?');params.push(status);}
 const sql=`WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total FROM announcements ${sql}`).get(...params) as {total:number};
 const rows=db.prepare(`${ANNOUNCEMENT_SELECT} ${sql} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as AnnouncementRow[];
 return{data:rows.map(plainAnnouncement),pagination:{page,pageSize,total}};
}

export function createAnnouncement(db:Database,actorId:string,input:unknown):Announcement{
 authorize(db,actorId);
 const v=createAnnouncementInput.parse(input);
 const id=randomUUID(),now=Date.now();
 return transaction(db,()=>{
  db.prepare('INSERT INTO announcements(metadata,id,title,body,link_url,link_label,target,starts_at,ends_at,status,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(JSON.stringify(v.metadata),id,v.title,v.body,v.linkUrl,v.linkLabel,v.target,toMs(v.startsAt),toMs(v.endsAt),v.status,actorId,actorId,now,now);
  audit(db,actorId,'content.announcement.create','announcement',id,{status:v.status,target:v.target});
  return row(db,id);
 });
}

export function updateAnnouncement(db:Database,actorId:string,id:string,input:unknown):Announcement{
 authorize(db,actorId);
 const {version,...changes}=updateAnnouncementInput.parse(input);
 return transaction(db,()=>{
  const current=row(db,id);
  if(current.version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  const merged={metadata:current.metadata,linkUrl:current.linkUrl,linkLabel:current.linkLabel,startsAt:iso(current.startsAt),endsAt:iso(current.endsAt),...changes};
  // 수정 후 전체 값이 규칙(링크 문구, 시작<종료)을 지키는지 검사한다.
  if(!announcementConsistent(merged))throw new z.ZodError([{code:'custom',path:[],message:announcementConsistencyMessage,input:merged}]);
  const keys=Object.keys(changes) as Field[];
  const value=(k:Field)=>k==='metadata'?JSON.stringify(changes.metadata):k==='startsAt'||k==='endsAt'?toMs(changes[k] as string|null):changes[k] as string;
  db.prepare(`UPDATE announcements SET ${keys.map(k=>COLUMNS[k]+'=?').join(',')},version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=?`)
   .run(...keys.map(value),actorId,Date.now(),id,version);
  audit(db,actorId,'content.announcement.update','announcement',id,{fields:keys});
  return row(db,id);
 });
}

export function deleteAnnouncement(db:Database,actorId:string,id:string,input:unknown){
 authorize(db,actorId);
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  if(row(db,id).version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  db.prepare('DELETE FROM announcements WHERE id=? AND version=?').run(id,version);
  audit(db,actorId,'content.announcement.delete','announcement',id);
  return{deleted:true};
 });
}
