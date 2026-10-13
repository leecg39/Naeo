import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {activePlan,planById} from './plans';
import {reserveDiscount,settleRedemption} from './coupons';
import {activatePaidPeriod,currentSubscription,DAY,endPaidPeriod} from './subscriptions';
import {ProviderError,type PaymentProvider,type ProviderPayment} from './provider';
import {checkoutInput,confirmInput,paymentQueryInput} from './validation';

export type PaymentStatus='ready'|'paid'|'failed'|'expired'|'canceled'|'partial_canceled';
export type Payment={id:string;userId:string|null;orderId:string;orderName:string;planId:string;listAmount:number;amount:number;couponRedemptionId:string|null;provider:'toss'|'none';status:PaymentStatus;
 paymentKey:string|null;method:string;canceledAmount:number;failureCode:string;failureMessage:string;subscriptionId:string|null;approvedAt:number|null;expiresAt:number;version:number;createdAt:number};
const SELECT=`SELECT id,user_id AS userId,order_id AS orderId,order_name AS orderName,plan_id AS planId,list_amount AS listAmount,amount,coupon_redemption_id AS couponRedemptionId,provider,status,payment_key AS paymentKey,method,
 canceled_amount AS canceledAmount,failure_code AS failureCode,failure_message AS failureMessage,subscription_id AS subscriptionId,approved_at AS approvedAt,expires_at AS expiresAt,version,created_at AS createdAt FROM payments`;
export const ORDER_TTL=30*60_000;
export const RENEW_WINDOW=3*DAY;
const orderIdOf=()=>randomBytes(24).toString('base64url');

export function paymentByOrder(db:Database,orderId:string):Payment|null{
 const p=db.prepare(`${SELECT} WHERE order_id=?`).get(orderId) as Payment|undefined;
 return p?{...p}:null;
}
export function paymentById(db:Database,id:string):Payment{
 const p=db.prepare(`${SELECT} WHERE id=?`).get(id) as Payment|undefined;
 if(!p)throw new AppError(404,'NOT_FOUND','결제를 찾을 수 없습니다.');
 return{...p};
}
/** /payment/complete가 서버에서 다시 조회하는 내 주문. 남의 주문은 404. */
export function paymentForOwner(db:Database,userId:string,orderId:string):Payment{
 const p=paymentByOrder(db,orderId);
 if(!p||p.userId!==userId)throw new AppError(404,'NOT_FOUND','결제를 찾을 수 없습니다.');
 return p;
}
export const myPayments=(db:Database,userId:string):Payment[]=>(db.prepare(`${SELECT} WHERE user_id=? AND status<>'ready' ORDER BY created_at DESC LIMIT 50`).all(userId) as Payment[]).map(p=>({...p}));
export function listAdminPayments(db:Database,actorId:string,query:unknown){
 requireAdmin(userById(db,actorId));
 const {page,pageSize,q,status}=paymentQueryInput.parse(query);
 const where=['(p.order_id LIKE ? OR coalesce(u.email,\'\') LIKE ?)'],params:(string|number)[]=[`%${q}%`,`%${q}%`];
 if(status){where.push('p.status=?');params.push(status);}
 const from=`FROM payments p LEFT JOIN users u ON u.id=p.user_id WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total ${from}`).get(...params) as {total:number};
 const ids=db.prepare(`SELECT p.id,coalesce(u.email,'(탈퇴 회원)') AS email ${from} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as {id:string;email:string}[];
 return{data:ids.map(r=>({...paymentById(db,r.id),email:r.email})),pagination:{page,pageSize,total}};
}

function markFailed(db:Database,p:Payment,status:'failed'|'expired',code:string,message:string,now:number){
 const r=db.prepare("UPDATE payments SET status=?,failure_code=?,failure_message=?,version=version+1,updated_at=? WHERE id=? AND status='ready'").run(status,code.slice(0,60),message.slice(0,300),now,p.id);
 if(r.changes)settleRedemption(db,p.couponRedemptionId,'released',p.id,now);
}
/** 승인 확정(트랜잭션 안): ready → paid 한 번만, 쿠폰 사용 처리, 구독 기간 시작·갱신. */
function finalizePaid(db:Database,p:Payment,result:Pick<ProviderPayment,'paymentKey'|'method'>|null,now:number):boolean{
 const r=db.prepare("UPDATE payments SET status='paid',payment_key=?,method=?,approved_at=?,version=version+1,updated_at=? WHERE id=? AND status='ready'").run(result?.paymentKey??null,result?.method??'',now,now,p.id);
 if(!r.changes)return false;
 settleRedemption(db,p.couponRedemptionId,'used',p.id,now);
 const sub=activatePaidPeriod(db,p.userId!,planById(db,p.planId),p.id,now);
 db.prepare('UPDATE payments SET subscription_id=? WHERE id=?').run(sub.id,p.id);
 audit(db,p.userId,'billing.payment.paid','payment',p.id,{amount:p.amount,provider:p.provider});
 return true;
}

/** 이 요금제를 지금 결제할 수 있는지: 체험·만료는 가능, 유료 이용 중이면 끝나기 3일 전부터 같은 요금제 연장만. */
function assertEligible(db:Database,userId:string,planId:string,now:number){
 const sub=currentSubscription(db,userId,now);
 if(!sub||sub.trial)return;
 if(sub.planId!==planId)throw new AppError(409,'PLAN_CHANGE_UNSUPPORTED','이용 중인 요금제가 끝난 뒤 다른 요금제를 결제할 수 있습니다.');
 if(sub.renewalPaymentId)throw new AppError(409,'RENEWAL_ALREADY_PAID','다음 기간 결제가 이미 완료되었습니다.');
 if(sub.currentPeriodEnd-now>RENEW_WINDOW)throw new AppError(409,'ALREADY_SUBSCRIBED','이용 기간이 끝나기 3일 전부터 연장 결제할 수 있습니다.');
}

/**
 * 주문 생성: 금액은 서버가 요금제·쿠폰으로 계산한다. 0원이면 공급자 없이 바로 확정.
 * 공급자 키가 없으면 아무것도 만들지 않고 503.
 */
export function createCheckout(db:Database,provider:PaymentProvider|null,userId:string,input:unknown,now=Date.now()){
 const v=checkoutInput.parse(input);
 return transaction(db,()=>{
  const plan=activePlan(db,v.planCode);
  if(plan.price<=0)throw new AppError(400,'FREE_PLAN','무료 요금제는 결제가 필요 없습니다.');
  assertEligible(db,userId,plan.id,now);
  for(const old of db.prepare("SELECT id FROM payments WHERE user_id=? AND status='ready'").all(userId) as {id:string}[])markFailed(db,paymentById(db,old.id),'expired','REPLACED','새 주문으로 바뀌었습니다.',now);
  const coupon=v.couponCode?reserveDiscount(db,userId,v.couponCode,plan,now):null;
  const amount=plan.price-(coupon?.discount??0);
  if(amount>0&&!provider)throw new AppError(503,'PAYMENT_PROVIDER_NOT_CONFIGURED','결제 기능이 아직 설정되지 않았습니다(미설정).');
  const id=randomUUID(),orderId=orderIdOf(),orderName=`NAEO ${plan.name} 30일 이용권`.slice(0,100);
  db.prepare('INSERT INTO payments(id,user_id,order_id,order_name,plan_id,list_amount,amount,coupon_redemption_id,provider,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(id,userId,orderId,orderName,plan.id,plan.price,amount,coupon?.redemptionId??null,amount>0?'toss':'none',now+ORDER_TTL,now,now);
  audit(db,userId,'billing.checkout','payment',id,{plan:plan.code,amount,coupon:coupon?.code??null});
  if(amount===0)finalizePaid(db,paymentById(db,id),null,now);
  const p=paymentById(db,id);
  return{orderId,orderName,listAmount:p.listAmount,amount,discount:coupon?.discount??0,status:p.status,clientKey:amount>0?provider!.clientKey:null,customerKey:createHash('sha256').update(`customer:${userId}`).digest('base64url').slice(0,40)};
 });
}

/** 결제창 성공 뒤 승인: 주인·상태·금액(서버 기록)을 확인하고 멱등 키로 공급자 승인. 같은 주문의 중복 승인은 같은 결과. */
export async function confirmPayment(db:Database,provider:PaymentProvider|null,userId:string,input:unknown,now=Date.now()):Promise<Payment>{
 const v=confirmInput.parse(input);
 type Check={done:Payment}|{error:AppError}|{pending:Payment};
 const check=transaction(db,():Check=>{
  const p=paymentByOrder(db,v.orderId);
  if(!p||p.userId!==userId)throw new AppError(404,'NOT_FOUND','결제를 찾을 수 없습니다.');
  if(p.status==='paid'){if(p.paymentKey===v.paymentKey)return{done:p};throw new AppError(409,'ORDER_ALREADY_PAID','이미 결제가 끝난 주문입니다.');}
  if(p.status!=='ready')throw new AppError(409,'PAYMENT_NOT_PENDING','진행 중인 결제가 아닙니다.');
  if(v.amount!==p.amount){markFailed(db,p,'failed','AMOUNT_MISMATCH','결제 금액이 주문과 다릅니다.',now);return{error:new AppError(400,'AMOUNT_MISMATCH','결제 금액이 주문과 다릅니다.')};}
  if(now>=p.expiresAt){markFailed(db,p,'expired','ORDER_EXPIRED','주문 시간이 지났습니다.',now);return{error:new AppError(409,'PAYMENT_EXPIRED','주문 시간이 지났습니다. 다시 결제해주세요.')};}
  return{pending:p};
 });
 if('done' in check)return check.done;
 if('error' in check)throw check.error;
 if(!provider)throw new AppError(503,'PAYMENT_PROVIDER_NOT_CONFIGURED','결제 기능이 아직 설정되지 않았습니다(미설정).');
 const p=check.pending;
 let result:ProviderPayment;
 try{result=await provider.confirm({paymentKey:v.paymentKey,orderId:p.orderId,amount:p.amount},`confirm-${p.orderId}`);}
 catch(e){
  if(!(e instanceof ProviderError))throw e;
  if(e.status>=500)throw new AppError(503,e.code,e.message);
  transaction(db,()=>markFailed(db,p,'failed',e.code,e.message,Date.now()));
  throw new AppError(402,'PAYMENT_FAILED',e.message);
 }
 return transaction(db,()=>{
  const current=paymentById(db,p.id);
  if(current.status==='paid')return current;
  if(result.orderId!==p.orderId||result.totalAmount!==p.amount||result.status!=='DONE'){markFailed(db,current,'failed','PROVIDER_MISMATCH','결제사 승인 내용이 주문과 다릅니다.',now);throw new AppError(502,'PROVIDER_MISMATCH','결제사 승인 내용이 주문과 다릅니다. 고객센터로 문의해주세요.');}
  finalizePaid(db,current,result,now);
  return paymentById(db,p.id);
 });
}

/** 취소 반영(트랜잭션 안): 누적 취소액으로 상태를 정하고 전액이면 그 결제가 산 기간을 끝낸다. */
export function applyCancellation(db:Database,p:Payment,totalCanceled:number,now:number){
 const canceled=Math.min(p.amount,totalCanceled);
 if(canceled<=p.canceledAmount)return false;
 db.prepare('UPDATE payments SET canceled_amount=?,status=?,version=version+1,updated_at=? WHERE id=?').run(canceled,canceled>=p.amount?'canceled':'partial_canceled',now,p.id);
 if(canceled>=p.amount)endPaidPeriod(db,p.id,now);
 audit(db,null,'billing.payment.canceled','payment',p.id,{canceled});
 return true;
}

const webhookInput=z.object({eventType:z.string().max(60),createdAt:z.string().max(40),data:z.object({paymentKey:z.string().min(1).max(200),orderId:z.string().max(64).optional(),status:z.string().max(40).optional()}).passthrough()}).passthrough();
/**
 * 토스 웹훅(PAYMENT_STATUS_CHANGED): 본문을 믿지 않고 paymentKey로 공급자에 다시 조회해 반영한다.
 * 같은 이벤트 재전송은 duplicate. 처리 결과는 payment_events에 남긴다.
 */
export async function handleTossWebhook(db:Database,provider:PaymentProvider|null,body:unknown,now=Date.now()){
 const e=webhookInput.parse(body);
 if(!provider)throw new AppError(503,'PAYMENT_PROVIDER_NOT_CONFIGURED','결제 기능이 설정되지 않았습니다.');
 const key=`${e.eventType}:${e.data.paymentKey}:${e.data.status??''}:${e.createdAt}`.slice(0,300);
 if(db.prepare('SELECT 1 FROM payment_events WHERE dedupe_key=?').get(key))return{result:'duplicate'};
 if(e.eventType!=='PAYMENT_STATUS_CHANGED')return remember(db,key,e.eventType,'','ignored',now);
 const real=await provider.get(e.data.paymentKey);
 return transaction(db,()=>{
  const p=paymentByOrder(db,real.orderId);
  if(!p)return rememberIn(db,key,e.eventType,real.orderId,'unknown_order',now);
  if(real.totalAmount!==p.amount)return rememberIn(db,key,e.eventType,p.orderId,'amount_mismatch',now);
  let result='noop';
  if(real.status==='DONE'&&p.status==='ready'&&finalizePaid(db,p,real,now))result='paid';
  else if(['CANCELED','PARTIAL_CANCELED'].includes(real.status)&&applyCancellation(db,p,real.totalAmount-real.balanceAmount,now))result='canceled';
  else if(['ABORTED','EXPIRED'].includes(real.status)&&p.status==='ready'){markFailed(db,p,real.status==='EXPIRED'?'expired':'failed',real.status,'결제가 완료되지 않았습니다.',now);result='failed';}
  return rememberIn(db,key,e.eventType,p.orderId,result,now);
 });
}
function rememberIn(db:Database,key:string,type:string,orderId:string,result:string,now:number){
 db.prepare('INSERT INTO payment_events(id,provider,dedupe_key,event_type,order_id,result,received_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING').run(randomUUID(),'toss',key,type,orderId,result,now);
 return{result};
}
const remember=(db:Database,key:string,type:string,orderId:string,result:string,now:number)=>transaction(db,()=>rememberIn(db,key,type,orderId,result,now));

/** 결제창을 닫고 떠난 주문 정리(작업자 주기 실행): 만료 처리와 쿠폰 예약 해제. */
export function expireStalePayments(db:Database,now=Date.now()):number{
 const stale=db.prepare("SELECT id FROM payments WHERE status='ready' AND expires_at<=? LIMIT 500").all(now) as {id:string}[];
 for(const {id} of stale)transaction(db,()=>markFailed(db,paymentById(db,id),'expired','ORDER_EXPIRED','주문 시간이 지났습니다.',now));
 return stale.length;
}

/** 결제창 실패·취소로 돌아온 내 주문을 바로 실패 처리하고 쿠폰 예약을 푼다. */
export function abandonCheckout(db:Database,userId:string,orderId:string,reason:{code?:string;message?:string},now=Date.now()){
 return transaction(db,()=>{
  const p=paymentByOrder(db,orderId);
  if(!p||p.userId!==userId)return null;
  markFailed(db,p,'failed',(reason.code??'USER_CANCEL').replace(/[^A-Z0-9_]/gi,'').slice(0,60)||'USER_CANCEL',(reason.message??'결제가 취소되었습니다.').slice(0,300),now);
  return paymentById(db,p.id);
 });
}
