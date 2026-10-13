import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {paginationInput} from '../validation';

export type LedgerEntry={id:string;delta:number;reason:'grant'|'generation'|'refund'|'adjust';refType:string;refId:string;note:string;createdAt:number};
const grantInput=z.object({delta:z.number().int().min(-100000).max(100000).refine(v=>v!==0,'0은 지급할 수 없습니다.'),note:z.string().trim().min(1).max(200)}).strict();

/** 잔액 = 원장 합계(지급·차감·환급). 별도 잔액 칸을 두지 않아 원장과 어긋날 수 없다. */
export function balance(db:Database,ownerId:string):number{
 return (db.prepare('SELECT coalesce(sum(delta),0) AS b FROM credit_ledger WHERE owner_id=?').get(ownerId) as {b:number}).b;
}
export function ledger(db:Database,ownerId:string,query:unknown){
 const {page,pageSize}=paginationInput.parse(query);
 const {total}=db.prepare('SELECT count(*) AS total FROM credit_ledger WHERE owner_id=?').get(ownerId) as {total:number};
 const rows=db.prepare('SELECT id,delta,reason,ref_type AS refType,ref_id AS refId,note,created_at AS createdAt FROM credit_ledger WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?').all(ownerId,pageSize,(page-1)*pageSize) as LedgerEntry[];
 return{data:rows.map(r=>({...r})),pagination:{page,pageSize,total},balance:balance(db,ownerId)};
}
/** 원장 기록(트랜잭션 안에서 호출). 같은 참조·사유는 한 번만 기록되고, 이미 있으면 false. */
export function record(db:Database,e:{ownerId:string;delta:number;reason:LedgerEntry['reason'];refType?:string;refId?:string;note?:string;createdBy?:string|null},now:number):boolean{
 const r=db.prepare(`INSERT INTO credit_ledger(id,owner_id,delta,reason,ref_type,ref_id,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)
  ON CONFLICT(ref_type,ref_id,reason) WHERE ref_id<>'' DO NOTHING`).run(randomUUID(),e.ownerId,e.delta,e.reason,e.refType??'',e.refId??'',e.note??'',e.createdBy??null,now);
 return r.changes>0;
}
/** 관리자 지급·회수(감사 기록). 잔액이 음수가 되는 회수는 거절한다. */
export function grantCredits(db:Database,actorId:string,userId:string,input:unknown,now=Date.now()){
 requireAdmin(userById(db,actorId));
 const v=grantInput.parse(input);
 return transaction(db,()=>{
  userById(db,userId);
  if(balance(db,userId)+v.delta<0)throw new AppError(409,'NEGATIVE_BALANCE','잔액보다 많이 회수할 수 없습니다.');
  record(db,{ownerId:userId,delta:v.delta,reason:v.delta>0?'grant':'adjust',note:v.note,createdBy:actorId},now);
  audit(db,actorId,'admin.credits.grant','user',userId,{delta:v.delta});
  return{balance:balance(db,userId)};
 });
}
