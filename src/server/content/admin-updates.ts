import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput} from '../validation';
import {renderMarkdown} from './markdown';
import {UPDATE_ORDER,UPDATE_SELECT,toUpdate,type SiteUpdate,type UpdateRow} from './updates';
import {createUpdateInput,updateQueryInput,updateUpdateInput} from './update-validation';

const COLUMNS={slug:'slug',versionLabel:'version_label',types:'types_json',title:'title',summary:'summary',bodyMarkdown:'body_markdown',publishedOn:'published_on',status:'status',position:'position'} as const;
type Field=keyof typeof COLUMNS;
const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));
function row(db:Database,id:string):SiteUpdate{
 const r=db.prepare(`${UPDATE_SELECT} WHERE id=?`).get(id) as UpdateRow|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','업데이트를 찾을 수 없습니다.');
 return toUpdate(r);
}
/** 저장 전에 본문을 렌더링해 차단된 주소·HTML·지원하지 않는 구성 요소가 있으면 거절한다. */
function checkBody(markdown:string|undefined){
 if(markdown===undefined)return;
 const r=renderMarkdown(markdown);
 if(r.warnings.length)throw new AppError(400,'CONTENT_INVALID','본문에 허용되지 않은 내용이 있습니다.',r.warnings);
}
function assertSlugFree(db:Database,slug:string,exceptId=''){
 if(db.prepare('SELECT 1 FROM site_updates WHERE slug=? AND id<>?').get(slug,exceptId))throw new AppError(409,'SLUG_EXISTS','같은 주소의 업데이트가 있습니다.');
}
const dbValue=(k:Field,v:unknown)=>k==='types'?JSON.stringify(v):v as string|number;

export function listAdminUpdates(db:Database,actorId:string,query:unknown){
 authorize(db,actorId);
 const {page,pageSize,q,status,type}=updateQueryInput.parse(query);
 const like=`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;
 const where=["(title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' OR version_label LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')"],params:(string|number)[]=[like,like,like,like];
 if(status){where.push('status=?');params.push(status);}
 if(type){where.push('EXISTS (SELECT 1 FROM json_each(types_json) WHERE value=?)');params.push(type);}
 const sql=`WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total FROM site_updates ${sql}`).get(...params) as {total:number};
 const rows=db.prepare(`${UPDATE_SELECT} ${sql} ${UPDATE_ORDER} LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as UpdateRow[];
 return{data:rows.map(toUpdate),pagination:{page,pageSize,total}};
}

export function getAdminUpdate(db:Database,actorId:string,id:string):SiteUpdate{authorize(db,actorId);return row(db,id);}

export function createUpdate(db:Database,actorId:string,input:unknown):SiteUpdate{
 authorize(db,actorId);
 const v=createUpdateInput.parse(input);
 checkBody(v.bodyMarkdown);
 const id=randomUUID(),now=Date.now();
 return transaction(db,()=>{
  assertSlugFree(db,v.slug);
  db.prepare(`INSERT INTO site_updates(id,slug,version_label,types_json,title,summary,body_markdown,published_on,status,position,created_by,updated_by,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,v.slug,v.versionLabel,JSON.stringify(v.types),v.title,v.summary,v.bodyMarkdown,v.publishedOn,v.status,v.position,actorId,actorId,now,now);
  audit(db,actorId,'content.update.create','update',id,{slug:v.slug,status:v.status});
  return row(db,id);
 });
}

export function updateUpdate(db:Database,actorId:string,id:string,input:unknown):SiteUpdate{
 authorize(db,actorId);
 const {version,...changes}=updateUpdateInput.parse(input);
 checkBody(changes.bodyMarkdown);
 return transaction(db,()=>{
  const current=row(db,id);
  if(current.version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  if(changes.slug!==undefined)assertSlugFree(db,changes.slug,id);
  const keys=Object.keys(changes) as Field[];
  db.prepare(`UPDATE site_updates SET ${keys.map(k=>COLUMNS[k]+'=?').join(',')},version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=?`)
   .run(...keys.map(k=>dbValue(k,changes[k])),actorId,Date.now(),id,version);
  audit(db,actorId,'content.update.update','update',id,{fields:keys});
  return row(db,id);
 });
}

export function deleteUpdate(db:Database,actorId:string,id:string,input:unknown){
 authorize(db,actorId);
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  const current=row(db,id);
  if(current.version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  db.prepare('DELETE FROM site_updates WHERE id=? AND version=?').run(id,version);
  audit(db,actorId,'content.update.delete','update',id,{slug:current.slug});
  return{deleted:true};
 });
}
