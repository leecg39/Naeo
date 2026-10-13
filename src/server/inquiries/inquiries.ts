import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import type {User} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput,paginationInput} from '../validation';
import {createInquiryInput,updateInquiryInput} from './validation';
import {INQUIRY_SELECT,assertVersion,inquiryRow,memberInquiry,memberReplies,type Inquiry,type InquiryRow,type Reply} from './records';

/**
 * 비회원·회원 모두 문의를 남길 수 있다. 약관에 동의한 활성 회원이면 본인 문의로 묶는다.
 * 감사 로그에는 이메일·본문 같은 개인 내용을 남기지 않는다.
 */
export function createInquiry(db:Database,user:User|null,input:unknown):Inquiry{
 const v=createInquiryInput.parse(input);
 const owner=user&&user.termsAcceptedAt?user.id:null;
 const id=randomUUID(),now=Date.now();
 return transaction(db,()=>{
  db.prepare('INSERT INTO inquiries(id,owner_id,email,type,subject,message,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,v.email,v.type,v.subject,v.message,now,now);
  audit(db,owner,'inquiry.create','inquiry',id,{type:v.type,guest:owner===null});
  return memberInquiry(inquiryRow(db,id));
 });
}

export function listMyInquiries(db:Database,userId:string,query:unknown){
 const {page,pageSize}=paginationInput.parse(query);
 const {total}=db.prepare('SELECT count(*) AS total FROM inquiries WHERE owner_id=?').get(userId) as {total:number};
 const rows=db.prepare(`${INQUIRY_SELECT} WHERE i.owner_id=? ORDER BY i.created_at DESC,i.id LIMIT ? OFFSET ?`).all(userId,pageSize,(page-1)*pageSize) as InquiryRow[];
 return {data:rows.map(memberInquiry),pagination:{page,pageSize,total}};
}

export function getMyInquiry(db:Database,userId:string,id:string):Inquiry&{replies:Reply[]}{
 return {...memberInquiry(inquiryRow(db,id,userId)),replies:memberReplies(db,id)};
}

/** 답변이 달리거나 처리 중이 아닌 문의는 고칠 수 없다(답변과 질문이 어긋나지 않도록). */
export function updateMyInquiry(db:Database,userId:string,id:string,input:unknown):Inquiry{
 const {version,...changes}=updateInquiryInput.parse(input);
 return transaction(db,()=>{
  const current=inquiryRow(db,id,userId);
  assertVersion(current.version,version);
  if(current.status!=='open'||current.reply_count>0)throw new AppError(409,'INQUIRY_LOCKED','답변을 받았거나 종료된 문의는 수정할 수 없습니다. 새 문의를 남겨주세요.');
  db.prepare('UPDATE inquiries SET type=coalesce(?,type),subject=coalesce(?,subject),message=coalesce(?,message),version=version+1,updated_at=? WHERE id=? AND version=?')
   .run(changes.type??null,changes.subject??null,changes.message??null,Date.now(),id,version);
  audit(db,userId,'inquiry.update','inquiry',id,{fields:Object.keys(changes)});
  return memberInquiry(inquiryRow(db,id));
 });
}

/** 본인 문의는 답변 여부와 관계없이 지울 수 있다(개인 데이터 삭제). 답변도 함께 지워진다. */
export function deleteMyInquiry(db:Database,userId:string,id:string,input:unknown){
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  const current=inquiryRow(db,id,userId);
  assertVersion(current.version,version);
  db.prepare('DELETE FROM inquiries WHERE id=? AND version=?').run(id,version);
  audit(db,userId,'inquiry.delete','inquiry',id);
  return {deleted:true};
 });
}
