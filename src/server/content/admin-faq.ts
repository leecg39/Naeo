import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput} from '../validation';
import {FAQ_SELECT,plainFaq,type FaqItem} from './faq';
import {createFaqInput,faqQueryInput,updateFaqInput} from './faq-validation';

const COLUMNS={category:'category',question:'question',answer:'answer',status:'status',position:'position'} as const;
type Field=keyof typeof COLUMNS;
const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));
function row(db:Database,id:string):FaqItem{
 const r=db.prepare(`${FAQ_SELECT} WHERE id=?`).get(id) as FaqItem|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','FAQ 항목을 찾을 수 없습니다.');
 return plainFaq(r);
}
function assertVersion(current:FaqItem,expected:number){
 if(current.version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
}

export function listAdminFaq(db:Database,actorId:string,query:unknown){
 authorize(db,actorId);
 const {page,pageSize,q,status,category}=faqQueryInput.parse(query);
 const like=`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;
 const where=["(question LIKE ? ESCAPE '\\' OR answer LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')"],params:(string|number)[]=[like,like,like];
 if(status){where.push('status=?');params.push(status);}
 if(category){where.push('category=?');params.push(category);}
 const sql=`WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total FROM faq_items ${sql}`).get(...params) as {total:number};
 const rows=db.prepare(`${FAQ_SELECT} ${sql} ORDER BY position,created_at LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as FaqItem[];
 const categories=(db.prepare('SELECT category FROM faq_items GROUP BY category ORDER BY min(position)').all() as {category:string}[]).map(c=>c.category);
 return{data:rows.map(plainFaq),pagination:{page,pageSize,total},categories};
}

export function createFaq(db:Database,actorId:string,input:unknown):FaqItem{
 authorize(db,actorId);
 const v=createFaqInput.parse(input);
 const id=randomUUID(),now=Date.now();
 return transaction(db,()=>{
  db.prepare('INSERT INTO faq_items(id,category,question,answer,status,position,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run(id,v.category,v.question,v.answer,v.status,v.position,actorId,actorId,now,now);
  audit(db,actorId,'content.faq.create','faq',id,{status:v.status});
  return row(db,id);
 });
}

export function updateFaq(db:Database,actorId:string,id:string,input:unknown):FaqItem{
 authorize(db,actorId);
 const {version,...changes}=updateFaqInput.parse(input);
 return transaction(db,()=>{
  assertVersion(row(db,id),version);
  const keys=Object.keys(changes) as Field[];
  db.prepare(`UPDATE faq_items SET ${keys.map(k=>COLUMNS[k]+'=?').join(',')},version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=?`)
   .run(...keys.map(k=>changes[k] as string|number),actorId,Date.now(),id,version);
  audit(db,actorId,'content.faq.update','faq',id,{fields:keys});
  return row(db,id);
 });
}

export function deleteFaq(db:Database,actorId:string,id:string,input:unknown){
 authorize(db,actorId);
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  assertVersion(row(db,id),version);
  db.prepare('DELETE FROM faq_items WHERE id=? AND version=?').run(id,version);
  audit(db,actorId,'content.faq.delete','faq',id);
  return{deleted:true};
 });
}
