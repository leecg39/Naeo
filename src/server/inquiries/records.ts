import type {Database} from '../database';
import {AppError} from '../errors';
import type {INQUIRY_STATUSES,INQUIRY_TYPES} from './validation';

export type Inquiry={id:string;ownerId:string|null;email:string;type:typeof INQUIRY_TYPES[number];subject:string;message:string;status:typeof INQUIRY_STATUSES[number];answeredAt:number|null;version:number;createdAt:number;updatedAt:number;replyCount:number};
export type Reply={mailState:'queued'|'sending'|'retry'|'accepted'|'failed'|null;id:string;body:string;delivery:'not_configured'|'sent'|'failed';createdAt:number;updatedAt:number};
export type AdminReply=Reply&{authorId:string|null;authorName:string|null};
export type AdminInquiry=Inquiry&{ownerEmail:string|null};

type Row={id:string;owner_id:string|null;email:string;type:Inquiry['type'];subject:string;message:string;status:Inquiry['status'];answered_at:number|null;version:number;created_at:number;updated_at:number;reply_count:number;owner_email:string|null};
export const INQUIRY_SELECT=`SELECT i.*,u.email AS owner_email,(SELECT count(*) FROM inquiry_messages m WHERE m.inquiry_id=i.id) AS reply_count
 FROM inquiries i LEFT JOIN users u ON u.id=i.owner_id`;

const toInquiry=(r:Row):Inquiry=>({id:r.id,ownerId:r.owner_id,email:r.email,type:r.type,subject:r.subject,message:r.message,status:r.status,answeredAt:r.answered_at,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at,replyCount:r.reply_count});
export const toAdminInquiry=(r:Row):AdminInquiry=>({...toInquiry(r),ownerEmail:r.owner_email});
export type InquiryRow=Row;

/** 문의를 읽는다. ownerId를 주면 그 회원의 문의만 찾는다(남의 문의는 존재 여부도 숨기고 404). */
export function inquiryRow(db:Database,id:string,ownerId?:string):Row{
 const r=(ownerId===undefined?db.prepare(`${INQUIRY_SELECT} WHERE i.id=?`).get(id):db.prepare(`${INQUIRY_SELECT} WHERE i.id=? AND i.owner_id=?`).get(id,ownerId)) as Row|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','문의를 찾을 수 없습니다.');
 return r;
}
export const memberInquiry=(r:Row)=>toInquiry(r);

export function adminReplies(db:Database,inquiryId:string):AdminReply[]{
 return (db.prepare(`SELECT (SELECT state FROM inquiry_mail WHERE reply_id=m.id) AS mailState,m.id,m.body,m.delivery,m.created_at AS createdAt,m.updated_at AS updatedAt,m.author_id AS authorId,p.nickname AS authorName
  FROM inquiry_messages m LEFT JOIN profiles p ON p.user_id=m.author_id WHERE m.inquiry_id=? ORDER BY m.created_at,m.id`).all(inquiryId) as AdminReply[]).map(r=>({...r}));
}
/** 회원에게는 어느 관리자가 답했는지 보여주지 않는다. */
export const memberReplies=(db:Database,inquiryId:string):Reply[]=>adminReplies(db,inquiryId).map(({id,body,delivery,mailState,createdAt,updatedAt})=>({id,body,delivery,mailState,createdAt,updatedAt}));

export function assertVersion(current:number,expected:number){
 if(current!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
}
export const likePattern=(q:string)=>`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;
