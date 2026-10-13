import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput} from '../validation';
import {inquiryQueryInput,inquiryStatusInput,replyInput} from './validation';
import {INQUIRY_SELECT,adminReplies,assertVersion,inquiryRow,likePattern,toAdminInquiry,type AdminInquiry,type AdminReply,type InquiryRow} from './records';

export type AdminInquiryDetail=AdminInquiry&{replies:AdminReply[]};
const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));
const detail=(db:Database,id:string):AdminInquiryDetail=>({...toAdminInquiry(inquiryRow(db,id)),replies:adminReplies(db,id)});

export function listAdminInquiries(db:Database,actorId:string,query:unknown){
 authorize(db,actorId);
 const {page,pageSize,q,status,type}=inquiryQueryInput.parse(query);
 const like=likePattern(q);
 const where=["(i.email LIKE ? ESCAPE '\\' OR i.subject LIKE ? ESCAPE '\\' OR i.message LIKE ? ESCAPE '\\')"],params:(string|number)[]=[like,like,like];
 if(status){where.push('i.status=?');params.push(status);}
 if(type){where.push('i.type=?');params.push(type);}
 const filter=where.join(' AND ');
 const {total}=db.prepare(`SELECT count(*) AS total FROM inquiries i WHERE ${filter}`).get(...params) as {total:number};
 const rows=db.prepare(`${INQUIRY_SELECT} WHERE ${filter} ORDER BY i.created_at DESC,i.id LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as InquiryRow[];
 return {data:rows.map(toAdminInquiry),pagination:{page,pageSize,total}};
}

export function getAdminInquiry(db:Database,actorId:string,id:string):AdminInquiryDetail{
 authorize(db,actorId);
 return detail(db,id);
}

/** 문의 상태·답변이 바뀔 때마다 문의 version을 올려 다른 관리자의 동시 수정을 막는다. */
function mutate(db:Database,actorId:string,id:string,expected:number,change:(now:number)=>void,action:string,metadata:Record<string,unknown>={}){
 authorize(db,actorId);
 return transaction(db,()=>{
  assertVersion(inquiryRow(db,id).version,expected);
  const now=Date.now();
  change(now);
  db.prepare('UPDATE inquiries SET version=version+1,updated_at=? WHERE id=?').run(now,id);
  audit(db,actorId,action,'inquiry',id,metadata);
  return detail(db,id);
 });
}

export function updateInquiryStatus(db:Database,actorId:string,id:string,input:unknown){
 const {status,version}=inquiryStatusInput.parse(input);
 return mutate(db,actorId,id,version,()=>db.prepare('UPDATE inquiries SET status=? WHERE id=?').run(status,id),'admin.inquiry.status',{status});
}

/**
 * 답변을 저장하고 문의를 '답변 완료'로 바꾼다. 메일 공급자가 연결되지 않았으므로
 * 답변은 발송하지 않고 delivery='not_configured'로 기록한다(회원은 /contact에서 확인).
 */
export function addReply(db:Database,actorId:string,id:string,input:unknown){
 const {body,version}=replyInput.parse(input);
 return mutate(db,actorId,id,version,now=>{
  db.prepare('INSERT INTO inquiry_messages(id,inquiry_id,author_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,actorId,body,now,now);
  db.prepare("UPDATE inquiries SET status='answered',answered_at=coalesce(answered_at,?) WHERE id=?").run(now,id);
 },'admin.inquiry.reply.create');
}

function assertReply(db:Database,id:string,replyId:string){
 if(!db.prepare('SELECT 1 FROM inquiry_messages WHERE id=? AND inquiry_id=?').get(replyId,id))throw new AppError(404,'REPLY_NOT_FOUND','답변을 찾을 수 없습니다.');
}
export function updateReply(db:Database,actorId:string,id:string,replyId:string,input:unknown){
 const {body,version}=replyInput.parse(input);
 return mutate(db,actorId,id,version,now=>{
  assertReply(db,id,replyId);
  db.prepare('UPDATE inquiry_messages SET body=?,updated_at=? WHERE id=?').run(body,now,replyId);
 },'admin.inquiry.reply.update',{replyId});
}
export function deleteReply(db:Database,actorId:string,id:string,replyId:string,input:unknown){
 const {version}=deleteInput.parse(input);
 return mutate(db,actorId,id,version,()=>{
  assertReply(db,id,replyId);
  db.prepare('DELETE FROM inquiry_messages WHERE id=?').run(replyId);
 },'admin.inquiry.reply.delete',{replyId});
}

export function deleteInquiry(db:Database,actorId:string,id:string,input:unknown){
 authorize(db,actorId);
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  assertVersion(inquiryRow(db,id).version,version);
  db.prepare('DELETE FROM inquiries WHERE id=? AND version=?').run(id,version);
  audit(db,actorId,'admin.inquiry.delete','inquiry',id);
  return {deleted:true};
 });
}
