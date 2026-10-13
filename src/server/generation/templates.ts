import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput,version} from '../validation';

export type WritingTemplate={id:string;name:string;category:string;guidance:string;status:'active'|'hidden';version:number;createdAt:number;updatedAt:number};
const SELECT='SELECT id,name,category,guidance,status,version,created_at AS createdAt,updated_at AS updatedAt FROM writing_templates';
const fields={name:z.string().trim().min(1).max(60),category:z.string().trim().max(30),guidance:z.string().trim().min(1).max(2000),status:z.enum(['active','hidden'])};
const createInput=z.object({...fields,category:fields.category.default(''),status:fields.status.default('active')}).strict();
const updateInput=z.object(fields).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));
function row(db:Database,id:string):WritingTemplate{
 const r=db.prepare(`${SELECT} WHERE id=?`).get(id) as WritingTemplate|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','글쓰기 템플릿을 찾을 수 없습니다.');
 return{...r};
}
function assertNameFree(db:Database,name:string,exceptId=''){
 if(db.prepare('SELECT 1 FROM writing_templates WHERE name=? COLLATE NOCASE AND id<>?').get(name,exceptId))throw new AppError(409,'TEMPLATE_EXISTS','같은 이름의 템플릿이 있습니다.');
}

/** 회원이 고를 수 있는 템플릿(이름·주제만, 지침 본문은 서버에서만 쓴다). */
export const activeTemplates=(db:Database)=>(db.prepare("SELECT id,name,category FROM writing_templates WHERE status='active' ORDER BY name").all() as {id:string;name:string;category:string}[]).map(r=>({...r}));
export function templateGuidance(db:Database,id:string):string{
 const r=db.prepare("SELECT guidance FROM writing_templates WHERE id=? AND status='active'").get(id) as {guidance:string}|undefined;
 if(!r)throw new AppError(404,'TEMPLATE_NOT_FOUND','글쓰기 템플릿을 찾을 수 없습니다.');
 return r.guidance;
}
export function listAdminTemplates(db:Database,actorId:string):WritingTemplate[]{authorize(db,actorId);return (db.prepare(`${SELECT} ORDER BY name`).all() as WritingTemplate[]).map(r=>({...r}));}
export function createWritingTemplate(db:Database,actorId:string,input:unknown):WritingTemplate{
 authorize(db,actorId);
 const v=createInput.parse(input);
 return transaction(db,()=>{
  assertNameFree(db,v.name);
  const id=randomUUID(),now=Date.now();
  db.prepare('INSERT INTO writing_templates(id,name,category,guidance,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,v.name,v.category,v.guidance,v.status,now,now);
  audit(db,actorId,'admin.writing_template.create','writing_template',id);
  return row(db,id);
 });
}
export function updateWritingTemplate(db:Database,actorId:string,id:string,input:unknown):WritingTemplate{
 authorize(db,actorId);
 const {version:expected,...v}=updateInput.parse(input);
 return transaction(db,()=>{
  if(row(db,id).version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  if(v.name!==undefined)assertNameFree(db,v.name,id);
  db.prepare('UPDATE writing_templates SET name=coalesce(?,name),category=coalesce(?,category),guidance=coalesce(?,guidance),status=coalesce(?,status),version=version+1,updated_at=? WHERE id=? AND version=?')
   .run(v.name??null,v.category??null,v.guidance??null,v.status??null,Date.now(),id,expected);
  audit(db,actorId,'admin.writing_template.update','writing_template',id,{fields:Object.keys(v)});
  return row(db,id);
 });
}
export function deleteWritingTemplate(db:Database,actorId:string,id:string,input:unknown){
 authorize(db,actorId);
 const {version:expected}=deleteInput.parse(input);
 return transaction(db,()=>{
  if(row(db,id).version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  db.prepare('DELETE FROM writing_templates WHERE id=? AND version=?').run(id,expected);
  audit(db,actorId,'admin.writing_template.delete','writing_template',id);
  return{deleted:true};
 });
}
