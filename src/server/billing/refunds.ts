import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,requireTerms,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {DAY} from './subscriptions';
import {applyCancellation,paymentById,type Payment} from './payments';
import {ProviderError,type PaymentProvider} from './provider';
import {IDEMPOTENCY_WINDOW,samePayment,canceledSnapshot} from './payment-contract';
import {adminRefundInput,refundDecisionInput,refundQueryInput,refundRequestInput} from './validation';

export type Refund={id:string;paymentId:string;userId:string|null;amount:number;reason:string;status:'requested'|'approved'|'rejected'|'completed'|'failed';decisionNote:string;failureMessage:string;decidedAt:number|null;providerStartedAt:number|null;cancelBase:number|null;version:number;createdAt:number};
const SELECT='SELECT id,payment_id AS paymentId,user_id AS userId,amount,reason,status,decision_note AS decisionNote,failure_message AS failureMessage,decided_at AS decidedAt,provider_started_at AS providerStartedAt,cancel_base AS cancelBase,version,created_at AS createdAt FROM refunds';
export const REFUND_WINDOW=7*DAY;

export function refundById(db:Database,id:string):Refund{
 const r=db.prepare(`${SELECT} WHERE id=?`).get(id) as Refund|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','환불 요청을 찾을 수 없습니다.');
 return{...r};
}
const remainingOf=(p:Payment)=>p.amount-p.canceledAmount;
function assertRefundable(db:Database,p:Payment){
 if(remainingOf(p)<=0&&p.status!=='ready')throw new AppError(409,'NOTHING_TO_REFUND','환불할 금액이 남아 있지 않습니다.');
 if(!['paid','partial_canceled'].includes(p.status))throw new AppError(409,'PAYMENT_NOT_PAID','결제가 완료된 주문만 환불할 수 있습니다.');
 if(db.prepare("SELECT 1 FROM refunds WHERE payment_id=? AND status IN ('requested','approved','failed')").get(p.id))throw new AppError(409,'REFUND_PENDING','처리 중인 환불 요청이 있습니다.');
}
function insertRefund(db:Database,p:Payment,amount:number,reason:string,actorId:string,now:number):Refund{
 const id=randomUUID();
 db.prepare('INSERT INTO refunds(id,payment_id,user_id,amount,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,p.id,p.userId,amount,reason,now,now);
 audit(db,actorId,'billing.refund.request','refund',id,{paymentId:p.id,amount});
 return refundById(db,id);
}

/** 회원 환불 요청: 승인 후 7일 안, 남은 금액 전부. 결정은 관리자가 한다. */
export function requestRefund(db:Database,userId:string,paymentId:string,input:unknown,now=Date.now()):Refund{
 const {reason}=refundRequestInput.parse(input);
 return transaction(db,()=>{
  const user=userById(db,userId);requireTerms(user);
  if(user.status!=='active')throw new AppError(401,'UNAUTHENTICATED','다시 로그인해주세요.');
  const p=paymentById(db,paymentId);
  if(p.userId!==userId)throw new AppError(404,'NOT_FOUND','결제를 찾을 수 없습니다.');
  assertRefundable(db,p);
  if(now>(p.approvedAt??0)+REFUND_WINDOW)throw new AppError(409,'REFUND_WINDOW_CLOSED','결제 후 7일이 지나 직접 환불을 요청할 수 없습니다. 문의하기로 연락해주세요.');
  return insertRefund(db,p,remainingOf(p),reason,userId,now);
 });
}

export const REFUND_GRACE=60_000;
/** Claim a durable attempt. Recovery reuses the same immutable request and fences late responses by version. */
function claimRefund(db:Database,adminId:string,refundId:string,v:ReturnType<typeof refundDecisionInput.parse>,now:number){
 return transaction(db,()=>{
  requireAdmin(userById(db,adminId));
  const r=refundById(db,refundId);
  if(r.version!==v.version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 처리했습니다. 최신 내용을 불러와주세요.');
  if(r.status==='approved'&&now-(r.decidedAt??now)<REFUND_GRACE)throw new AppError(409,'REFUND_PROCESSING','환불 처리 중입니다. 잠시 후 다시 확인해주세요.');
  if(!['requested','failed','approved'].includes(r.status))throw new AppError(409,'REFUND_DECIDED','이미 처리된 환불 요청입니다.');
  if(v.decision==='rejected'&&r.status!=='requested')throw new AppError(409,'REFUND_UNCERTAIN','이미 취소 요청한 환불은 거절할 수 없습니다. 결과를 먼저 확인해주세요.');
  const p=paymentById(db,r.paymentId);
  if(v.decision==='approved'&&r.providerStartedAt===null&&r.amount>remainingOf(p))throw new AppError(409,'NOTHING_TO_REFUND','환불할 금액이 남아 있지 않습니다.');
  if(v.decision==='approved'&&r.providerStartedAt!==null&&r.cancelBase===null)throw new AppError(409,'REFUND_RECONCILIATION_REQUIRED','이전 버전의 미확정 환불입니다. 결제사 거래 기록과 대조가 필요합니다.');
  db.prepare(`UPDATE refunds SET status=?,decision_note=?,decided_by=?,decided_at=?,
   provider_started_at=CASE WHEN ?='approved' THEN coalesce(provider_started_at,?) ELSE provider_started_at END,
   cancel_base=CASE WHEN ?='approved' THEN coalesce(cancel_base,?) ELSE cancel_base END,
   version=version+1,updated_at=? WHERE id=?`).run(v.decision,v.note,adminId,now,v.decision,now,v.decision,p.canceledAmount,now,refundId);
  audit(db,adminId,'admin.refund.decide','refund',refundId,{decision:v.decision});
  return refundById(db,refundId);
 });
}
function actorIfPresent(db:Database,id:string){return db.prepare('SELECT 1 FROM users WHERE id=?').get(id)?id:null;}
/** Errors remain attached to this refund ID; new requests cannot create a second cancel operation. */
export async function decideRefund(db:Database,provider:PaymentProvider|null,adminId:string,refundId:string,input:unknown,now=Date.now()):Promise<Refund>{
 requireAdmin(userById(db,adminId));
 const v=refundDecisionInput.parse(input);
 if(v.decision==='approved'&&!provider)throw new AppError(503,'PAYMENT_PROVIDER_NOT_CONFIGURED','결제 기능이 설정되지 않아 환불할 수 없습니다(미설정).');
 const r=claimRefund(db,adminId,refundId,v,now);
 if(v.decision==='rejected')return r;
 const p=paymentById(db,r.paymentId);
 try{
  // After 15 days the provider may forget the key. A lookup may reconcile a completed cancellation;
  // it must never send a fresh money-moving request with an expired key.
  const expired=now-r.providerStartedAt!>=IDEMPOTENCY_WINDOW;
  const result=expired?await provider!.get(p.paymentKey!):await provider!.cancel(p.paymentKey!,{reason:r.reason,amount:r.amount},`refund-${r.id}`);
  if(!samePayment(result,p)||!canceledSnapshot(result)||result.totalAmount-result.balanceAmount!==r.cancelBase!+r.amount)
   throw new ProviderError(expired?'REFUND_RECONCILIATION_REQUIRED':'PROVIDER_MISMATCH','취소 거래·금액이 요청과 일치하지 않습니다. 결제사 내역 확인이 필요합니다.',502);
  return transaction(db,()=>{
   const current=refundById(db,r.id);
   if(current.status==='completed')return current;
   if(current.status!=='approved'||current.version!==r.version)throw new AppError(409,'REFUND_PROCESSING','다른 요청이 환불을 확인 중입니다. 최신 결과를 조회해주세요.');
   applyCancellation(db,paymentById(db,p.id),result.totalAmount-result.balanceAmount,now);
   db.prepare("UPDATE refunds SET status='completed',failure_message='',version=version+1,updated_at=? WHERE id=? AND version=?").run(now,r.id,r.version);
   audit(db,actorIfPresent(db,adminId),'admin.refund.complete','refund',r.id,{amount:r.amount});
   return refundById(db,r.id);
  });
 }catch(e){
  const current=refundById(db,r.id);
  if(current.status==='completed')return current;
  const message=e instanceof ProviderError?e.message:'환불 결과를 확인하지 못했습니다. 같은 요청을 다시 확인해주세요.';
  transaction(db,()=>db.prepare("UPDATE refunds SET status='failed',failure_message=?,version=version+1,updated_at=? WHERE id=? AND status='approved' AND version=?").run(message.slice(0,300),now,r.id,r.version));
  throw new AppError(502,'REFUND_FAILED',message);
 }
}

/** 관리자가 직접 여는 환불(기간 제한 없음, 부분 금액 가능)과 즉시 승인. */
export async function createAdminRefund(db:Database,provider:PaymentProvider|null,adminId:string,paymentId:string,input:unknown,now=Date.now()):Promise<Refund>{
 requireAdmin(userById(db,adminId));
 const v=adminRefundInput.parse(input);
 if(!provider)throw new AppError(503,'PAYMENT_PROVIDER_NOT_CONFIGURED','결제 기능이 설정되지 않아 환불할 수 없습니다(미설정).');
 const r=transaction(db,()=>{
  const p=paymentById(db,paymentId);
  assertRefundable(db,p);
  const amount=v.amount??remainingOf(p);
  if(amount>remainingOf(p))throw new AppError(400,'AMOUNT_TOO_LARGE','남은 결제 금액보다 많이 환불할 수 없습니다.');
  return insertRefund(db,p,amount,v.reason,adminId,now);
 });
 return decideRefund(db,provider,adminId,r.id,{decision:'approved',version:r.version},now);
}

export const myRefunds=(db:Database,userId:string):Refund[]=>(db.prepare(`${SELECT} WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(userId) as Refund[]).map(r=>({...r}));
export function listAdminRefunds(db:Database,actorId:string,query:unknown){
 requireAdmin(userById(db,actorId));
 const {page,pageSize,status}=refundQueryInput.parse(query);
 const where=status?'WHERE r.status=?':'',params=status?[status]:[];
 const {total}=db.prepare(`SELECT count(*) AS total FROM refunds r ${where}`).get(...params) as {total:number};
 const rows=db.prepare(`SELECT r.id,coalesce(u.email,'(탈퇴 회원)') AS email,p.order_id AS orderId,p.order_name AS orderName FROM refunds r JOIN payments p ON p.id=r.payment_id LEFT JOIN users u ON u.id=r.user_id ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`)
  .all(...params,pageSize,(page-1)*pageSize) as {id:string;email:string;orderId:string;orderName:string}[];
 return{data:rows.map(x=>({...refundById(db,x.id),email:x.email,orderId:x.orderId,orderName:x.orderName})),pagination:{page,pageSize,total}};
}
