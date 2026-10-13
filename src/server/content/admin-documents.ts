import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput} from '../validation';
import {capturedPaths} from '../../lib/pages';
import {DOCUMENT_SELECT,SEEDED_DOCUMENT_PATHS,toDocument,type DocumentRow,type SiteDocument} from './documents';
import {RESERVED_ROOTS,createDocumentInput,documentQueryInput,restoreDocumentInput,updateDocumentInput} from './document-validation';

type Snapshot=Pick<SiteDocument,'path'|'title'|'effectiveLabel'|'body'|'closingNote'|'status'|'position'>;
export type DocumentRevision={version:number;createdAt:number;authorId:string|null};
const COLUMNS:Record<keyof Snapshot,string>={path:'path',title:'title',effectiveLabel:'effective_label',body:'body',closingNote:'closing_note',status:'status',position:'position'};

const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));
const conflict=()=>new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
function row(db:Database,id:string):SiteDocument{
 const r=db.prepare(`${DOCUMENT_SELECT} WHERE id=?`).get(id) as DocumentRow|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','문서를 찾을 수 없습니다.');
 return toDocument(r);
}
const snapshotOf=(d:SiteDocument):Snapshot=>({path:d.path,title:d.title,effectiveLabel:d.effectiveLabel,body:d.body,closingNote:d.closingNote,status:d.status,position:d.position});
function saveRevision(db:Database,d:SiteDocument,authorId:string|null,now:number){
 db.prepare("INSERT INTO content_revisions(id,resource_type,resource_id,version,snapshot_json,author_id,created_at) VALUES(?,'document',?,?,?,?,?) ON CONFLICT DO NOTHING")
  .run(randomUUID(),d.id,d.version,JSON.stringify(snapshotOf(d)),authorId,now);
}
/** 같은 주소의 문서, 다른 화면이 쓰는 주소(캡처 화면·예약 경로)는 거절한다. 시드 정책 문서 주소는 다시 쓸 수 있다. */
function assertPathFree(db:Database,path:string,exceptId=''){
 if(db.prepare('SELECT 1 FROM site_documents WHERE path=? AND id<>?').get(path,exceptId))throw new AppError(409,'PATH_EXISTS','같은 주소의 문서가 있습니다.');
 const reserved=RESERVED_ROOTS.includes(path.split('/')[1])||(capturedPaths.includes(path)&&!SEEDED_DOCUMENT_PATHS.includes(path));
 if(reserved)throw new AppError(409,'PATH_RESERVED','다른 화면이 쓰는 주소라 문서 주소로 쓸 수 없습니다.');
}

export function listAdminDocuments(db:Database,actorId:string,query:unknown){
 authorize(db,actorId);
 const {page,pageSize,q,status}=documentQueryInput.parse(query);
 const like=`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;
 const where=["(title LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\')"],params:(string|number)[]=[like,like];
 if(status){where.push('status=?');params.push(status);}
 const sql=`WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total FROM site_documents ${sql}`).get(...params) as {total:number};
 const rows=db.prepare(`${DOCUMENT_SELECT} ${sql} ORDER BY position,path LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as DocumentRow[];
 return{data:rows.map(toDocument),pagination:{page,pageSize,total}};
}

export function getAdminDocument(db:Database,actorId:string,id:string):SiteDocument&{revisions:DocumentRevision[]}{
 authorize(db,actorId);
 const d=row(db,id);
 const revisions=(db.prepare("SELECT version,created_at AS createdAt,author_id AS authorId FROM content_revisions WHERE resource_type='document' AND resource_id=? ORDER BY version DESC").all(id) as DocumentRevision[]).map(r=>({...r}));
 return{...d,revisions};
}

export function createDocument(db:Database,actorId:string,input:unknown):SiteDocument{
 authorize(db,actorId);
 const v=createDocumentInput.parse(input);
 const id=randomUUID(),now=Date.now();
 return transaction(db,()=>{
  assertPathFree(db,v.path);
  db.prepare('INSERT INTO site_documents(id,path,title,effective_label,body,closing_note,status,position,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(id,v.path,v.title,v.effectiveLabel,v.body,v.closingNote,v.status,v.position,actorId,actorId,now,now);
  const created=row(db,id);
  saveRevision(db,created,actorId,now);
  audit(db,actorId,'content.document.create','document',id,{path:v.path,status:v.status});
  return created;
 });
}

/** 바뀐 필드만 낙관적 잠금(version)으로 갱신하고 갱신 전·후를 수정 이력에 남긴다. */
function applyUpdate(db:Database,actorId:string,id:string,changes:Partial<Snapshot>,expected:number,action:string):SiteDocument{
 const now=Date.now();
 return transaction(db,()=>{
  const current=row(db,id);
  if(current.version!==expected)throw conflict();
  if(changes.path!==undefined&&changes.path!==current.path)assertPathFree(db,changes.path,id);
  saveRevision(db,current,null,current.updatedAt);
  const keys=Object.keys(changes) as (keyof Snapshot)[];
  db.prepare(`UPDATE site_documents SET ${keys.map(k=>COLUMNS[k]+'=?').join(',')},version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=?`)
   .run(...keys.map(k=>changes[k] as string|number),actorId,now,id,expected);
  const updated=row(db,id);
  saveRevision(db,updated,actorId,now);
  audit(db,actorId,action,'document',id,{fields:keys,version:updated.version});
  return updated;
 });
}

export function updateDocument(db:Database,actorId:string,id:string,input:unknown):SiteDocument{
 authorize(db,actorId);
 const {version,...changes}=updateDocumentInput.parse(input);
 return applyUpdate(db,actorId,id,changes,version,'content.document.update');
}

/** 지난 버전의 내용으로 되돌린다. 공개 상태와 순서는 현재 값을 유지한다. */
export function restoreDocumentRevision(db:Database,actorId:string,id:string,input:unknown):SiteDocument{
 authorize(db,actorId);
 const {revision,version}=restoreDocumentInput.parse(input);
 const snap=db.prepare("SELECT snapshot_json FROM content_revisions WHERE resource_type='document' AND resource_id=? AND version=?").get(id,revision) as {snapshot_json:string}|undefined;
 if(!snap)throw new AppError(404,'REVISION_NOT_FOUND','해당 버전을 찾을 수 없습니다.');
 const s=JSON.parse(snap.snapshot_json) as Snapshot;
 return applyUpdate(db,actorId,id,{path:s.path,title:s.title,effectiveLabel:s.effectiveLabel,body:s.body,closingNote:s.closingNote},version,'content.document.restore');
}

export function deleteDocument(db:Database,actorId:string,id:string,input:unknown){
 authorize(db,actorId);
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  const current=row(db,id);
  if(current.version!==version)throw conflict();
  db.prepare('DELETE FROM site_documents WHERE id=? AND version=?').run(id,version);
  audit(db,actorId,'content.document.delete','document',id,{path:current.path});
  return{deleted:true};
 });
}
