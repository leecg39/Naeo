import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {version} from '../validation';
import {PAGE_SETTING_SELECT,type PageSetting} from './page-settings';

const updateInput=z.object({title:z.string().trim().min(1).max(120).optional(),description:z.string().trim().max(300).optional(),status:z.enum(['published','hidden']).optional(),version}).strict()
 .refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
const restoreInput=z.object({revision:z.number().int().positive(),version}).strict();
type Snapshot=Pick<PageSetting,'title'|'description'|'status'>;
export type PageSettingRevision={version:number;createdAt:number;authorId:string|null};

const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));
function row(db:Database,id:string):PageSetting{
 const r=db.prepare(`${PAGE_SETTING_SELECT} WHERE id=?`).get(id) as PageSetting|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','페이지 설정을 찾을 수 없습니다.');
 return{...r};
}
function saveRevision(db:Database,p:PageSetting,authorId:string|null,now:number){
 const snap:Snapshot={title:p.title,description:p.description,status:p.status};
 db.prepare("INSERT INTO content_revisions(id,resource_type,resource_id,version,snapshot_json,author_id,created_at) VALUES(?,'page',?,?,?,?,?) ON CONFLICT DO NOTHING")
  .run(randomUUID(),p.id,p.version,JSON.stringify(snap),authorId,now);
}
function apply(db:Database,actorId:string,id:string,changes:Partial<Snapshot>,expected:number,action:string):PageSetting{
 const now=Date.now();
 return transaction(db,()=>{
  const current=row(db,id);
  if(current.version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  saveRevision(db,current,null,current.updatedAt);
  db.prepare('UPDATE page_settings SET title=coalesce(?,title),description=coalesce(?,description),status=coalesce(?,status),version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=?')
   .run(changes.title??null,changes.description??null,changes.status??null,actorId,now,id,expected);
  const updated=row(db,id);
  saveRevision(db,updated,actorId,now);
  audit(db,actorId,action,'page',id,{path:current.path,fields:Object.keys(changes)});
  return updated;
 });
}

export function listPageSettings(db:Database,actorId:string):PageSetting[]{
 authorize(db,actorId);
 return (db.prepare(`${PAGE_SETTING_SELECT} ORDER BY path`).all() as PageSetting[]).map(r=>({...r}));
}
export function getPageSetting(db:Database,actorId:string,id:string):PageSetting&{revisions:PageSettingRevision[]}{
 authorize(db,actorId);
 const revisions=(db.prepare("SELECT version,created_at AS createdAt,author_id AS authorId FROM content_revisions WHERE resource_type='page' AND resource_id=? ORDER BY version DESC").all(id) as PageSettingRevision[]).map(r=>({...r}));
 return{...row(db,id),revisions};
}
export function updatePageSetting(db:Database,actorId:string,id:string,input:unknown):PageSetting{
 authorize(db,actorId);
 const {version:expected,...changes}=updateInput.parse(input);
 return apply(db,actorId,id,changes,expected,'content.page.update');
}
/** 지난 버전의 제목·설명으로 되돌린다. 공개 여부는 현재 값을 유지한다. */
export function restorePageSettingRevision(db:Database,actorId:string,id:string,input:unknown):PageSetting{
 authorize(db,actorId);
 const {revision,version:expected}=restoreInput.parse(input);
 const snap=db.prepare("SELECT snapshot_json FROM content_revisions WHERE resource_type='page' AND resource_id=? AND version=?").get(id,revision) as {snapshot_json:string}|undefined;
 if(!snap)throw new AppError(404,'REVISION_NOT_FOUND','해당 버전을 찾을 수 없습니다.');
 const s=JSON.parse(snap.snapshot_json) as Snapshot;
 return apply(db,actorId,id,{title:s.title,description:s.description},expected,'content.page.restore');
}
