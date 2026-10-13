import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput} from '../validation';
import {createTemplateInput,updateTemplateInput} from './validation';
import {assertVersion} from './records';

export type InquiryTemplate={id:string;name:string;subject:string;body:string;version:number;createdAt:number;updatedAt:number};
const SELECT='SELECT id,name,subject,body,version,created_at AS createdAt,updated_at AS updatedAt FROM inquiry_templates';
const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));

function template(db:Database,id:string):InquiryTemplate{
 const t=db.prepare(`${SELECT} WHERE id=?`).get(id) as InquiryTemplate|undefined;
 if(!t)throw new AppError(404,'NOT_FOUND','답변 템플릿을 찾을 수 없습니다.');
 return {...t};
}
function assertNameFree(db:Database,name:string,exceptId=''){
 if(db.prepare('SELECT 1 FROM inquiry_templates WHERE name=? AND id<>?').get(name,exceptId))throw new AppError(409,'TEMPLATE_EXISTS','같은 이름의 템플릿이 있습니다.');
}

export function listTemplates(db:Database,actorId:string):InquiryTemplate[]{
 authorize(db,actorId);
 // node:sqlite 행은 prototype이 없는 객체라 클라이언트 컴포넌트로 넘길 수 있게 일반 객체로 바꾼다.
 return (db.prepare(`${SELECT} ORDER BY name`).all() as InquiryTemplate[]).map(t=>({...t}));
}
export function createTemplate(db:Database,actorId:string,input:unknown):InquiryTemplate{
 authorize(db,actorId);
 const v=createTemplateInput.parse(input);
 return transaction(db,()=>{
  assertNameFree(db,v.name);
  const id=randomUUID(),now=Date.now();
  db.prepare('INSERT INTO inquiry_templates(id,name,subject,body,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,v.name,v.subject,v.body,now,now);
  audit(db,actorId,'admin.inquiry_template.create','inquiry_template',id);
  return template(db,id);
 });
}
export function updateTemplate(db:Database,actorId:string,id:string,input:unknown):InquiryTemplate{
 authorize(db,actorId);
 const {version,...v}=updateTemplateInput.parse(input);
 return transaction(db,()=>{
  assertVersion(template(db,id).version,version);
  if(v.name!==undefined)assertNameFree(db,v.name,id);
  db.prepare('UPDATE inquiry_templates SET name=coalesce(?,name),subject=coalesce(?,subject),body=coalesce(?,body),version=version+1,updated_at=? WHERE id=? AND version=?')
   .run(v.name??null,v.subject??null,v.body??null,Date.now(),id,version);
  audit(db,actorId,'admin.inquiry_template.update','inquiry_template',id,{fields:Object.keys(v)});
  return template(db,id);
 });
}
export function deleteTemplate(db:Database,actorId:string,id:string,input:unknown){
 authorize(db,actorId);
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  assertVersion(template(db,id).version,version);
  db.prepare('DELETE FROM inquiry_templates WHERE id=? AND version=?').run(id,version);
  audit(db,actorId,'admin.inquiry_template.delete','inquiry_template',id);
  return {deleted:true};
 });
}
