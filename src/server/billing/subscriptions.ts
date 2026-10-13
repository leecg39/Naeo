import {createHash,randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {audit} from '../audit';
import {AppError} from '../errors';
import {balance,record} from '../credits/ledger';
import {activePlan,type Plan} from './plans';
import {trialInput,versionInput} from './validation';

export const DAY=86_400_000;
export const PERIOD_DAYS=30;
export type Subscription={id:string;userId:string;planId:string;planCode:string;planName:string;status:'trialing'|'active'|'canceled'|'expired';trial:boolean;
 currentPeriodStart:number;currentPeriodEnd:number;cancelAtPeriodEnd:boolean;periodTokens:number;periodPaymentId:string|null;renewalPaymentId:string|null;version:number};
type Raw=Omit<Subscription,'trial'|'cancelAtPeriodEnd'>&{trial:number;cancelAtPeriodEnd:number};
const SELECT=`SELECT s.id,s.user_id AS userId,s.plan_id AS planId,p.code AS planCode,p.name AS planName,s.status,s.trial,s.current_period_start AS currentPeriodStart,s.current_period_end AS currentPeriodEnd,
 s.cancel_at_period_end AS cancelAtPeriodEnd,s.period_tokens AS periodTokens,s.period_payment_id AS periodPaymentId,s.renewal_payment_id AS renewalPaymentId,s.version FROM subscriptions s JOIN plans p ON p.id=s.plan_id`;
const plain=(r:Raw):Subscription=>({...r,trial:r.trial===1,cancelAtPeriodEnd:r.cancelAtPeriodEnd===1});
const fingerprint=(v:string)=>createHash('sha256').update(v).digest('hex');

export function subscriptionById(db:Database,id:string):Subscription{
 return plain(db.prepare(`${SELECT} WHERE s.id=?`).get(id) as Raw);
}
/** 진행 중(체험·유료) 구독. 기간이 끝났으면 갱신 작업 전이라도 없는 것으로 본다. */
export function currentSubscription(db:Database,userId:string,now=Date.now()):Subscription|null{
 const r=db.prepare(`${SELECT} WHERE s.user_id=? AND s.status IN ('trialing','active')`).get(userId) as Raw|undefined;
 return r&&r.currentPeriodEnd>now?plain(r):null;
}
function liveRow(db:Database,userId:string):Subscription|null{
 const r=db.prepare(`${SELECT} WHERE s.user_id=? AND s.status IN ('trialing','active')`).get(userId) as Raw|undefined;
 return r?plain(r):null;
}
function grantPeriod(db:Database,sub:{id:string;userId:string},start:number,tokens:number,note:string){
 if(tokens>0)record(db,{ownerId:sub.userId,delta:tokens,reason:'subscription',refType:'subscription',refId:`${sub.id}:${start}`,note},start);
}
/**
 * 기간 토큰 소멸: 기간 지급분 중 그 기간에 쓰지 않은 만큼만(생성 차감·환급 순합으로 사용량 계산), 잔액을 넘지 않게.
 * 같은 기간은 원장 고유 키로 한 번만 기록된다.
 */
export function expirePeriodTokens(db:Database,sub:Subscription,until:number){
 const {net}=db.prepare("SELECT coalesce(sum(delta),0) AS net FROM credit_ledger WHERE owner_id=? AND reason IN ('generation','refund') AND created_at>=? AND created_at<?").get(sub.userId,sub.currentPeriodStart,until) as {net:number};
 const unused=Math.max(0,sub.periodTokens-Math.max(0,-net));
 const amount=Math.min(unused,balance(db,sub.userId));
 if(amount>0)record(db,{ownerId:sub.userId,delta:-amount,reason:'expire',refType:'subscription',refId:`${sub.id}:${sub.currentPeriodStart}`,note:'기간 종료로 남은 구독 토큰 소멸'},until);
 return amount;
}

/** 7일 체험(요금제별 일수): 계정·이메일·대표 블로그마다 평생 한 번. 기간 비례 토큰 지급. */
export function startTrial(db:Database,userId:string,input:unknown,now=Date.now()):Subscription{
 const {planCode}=trialInput.parse(input);
 return transaction(db,()=>{
  const plan=activePlan(db,planCode);
  if(plan.trialDays<=0)throw new AppError(409,'TRIAL_NOT_AVAILABLE','체험을 제공하지 않는 요금제입니다.');
  if(liveRow(db,userId))throw new AppError(409,'ALREADY_SUBSCRIBED','이미 이용 중인 구독이 있습니다.');
  const blog=db.prepare('SELECT naver_id AS naverId FROM blogs WHERE owner_id=? AND is_primary=1').get(userId) as {naverId:string}|undefined;
  if(!blog)throw new AppError(400,'BLOG_REQUIRED','체험을 시작하려면 설정에서 대표 블로그를 먼저 등록해주세요.');
  const {email}=db.prepare('SELECT email FROM users WHERE id=?').get(userId) as {email:string};
  const marks:[string,string][]=[['user',fingerprint(`user:${userId}`)],['email',fingerprint(`email:${email}`)],['blog',fingerprint(`blog:${blog.naverId}`)]];
  if(marks.some(([kind,hash])=>db.prepare('SELECT 1 FROM trial_fingerprints WHERE kind=? AND value_hash=?').get(kind,hash)))throw new AppError(409,'TRIAL_ALREADY_USED','이미 체험을 사용한 계정·이메일·블로그입니다.');
  for(const [kind,hash] of marks)db.prepare('INSERT INTO trial_fingerprints(kind,value_hash,created_at) VALUES(?,?,?)').run(kind,hash,now);
  const id=randomUUID(),tokens=Math.round(plan.monthlyTokens*plan.trialDays/PERIOD_DAYS);
  db.prepare("INSERT INTO subscriptions(id,user_id,plan_id,status,trial,current_period_start,current_period_end,period_tokens,created_at,updated_at) VALUES(?,?,?,'trialing',1,?,?,?,?,?)")
   .run(id,userId,plan.id,now,now+plan.trialDays*DAY,tokens,now,now);
  grantPeriod(db,{id,userId},now,tokens,`${plan.name} ${plan.trialDays}일 체험`);
  audit(db,userId,'billing.trial.start','subscription',id,{plan:plan.code,tokens});
  return subscriptionById(db,id);
 });
}

function ownLive(db:Database,userId:string,version:number,now:number):Subscription{
 const sub=currentSubscription(db,userId,now);
 if(!sub)throw new AppError(404,'NO_SUBSCRIPTION','이용 중인 구독이 없습니다.');
 if(sub.version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 변경했습니다. 새로고침해주세요.');
 return sub;
}
/** 해지 예약: 이번 기간 끝까지 이용하고 갱신하지 않는다. */
export function cancelSubscription(db:Database,userId:string,input:unknown,now=Date.now()):Subscription{
 const {version}=versionInput.parse(input);
 return transaction(db,()=>{
  const sub=ownLive(db,userId,version,now);
  db.prepare('UPDATE subscriptions SET cancel_at_period_end=1,version=version+1,updated_at=? WHERE id=?').run(now,sub.id);
  audit(db,userId,'billing.subscription.cancel','subscription',sub.id);
  return subscriptionById(db,sub.id);
 });
}
export function resumeSubscription(db:Database,userId:string,input:unknown,now=Date.now()):Subscription{
 const {version}=versionInput.parse(input);
 return transaction(db,()=>{
  const sub=ownLive(db,userId,version,now);
  db.prepare('UPDATE subscriptions SET cancel_at_period_end=0,version=version+1,updated_at=? WHERE id=?').run(now,sub.id);
  audit(db,userId,'billing.subscription.resume','subscription',sub.id);
  return subscriptionById(db,sub.id);
 });
}

/** 결제 승인 시(트랜잭션 안): 새 구독 시작, 체험을 유료로 전환, 또는 같은 요금제 갱신 예약. */
export function activatePaidPeriod(db:Database,userId:string,plan:Plan,paymentId:string,now:number):Subscription{
 const live=liveRow(db,userId);
 const start=(id:string)=>{
  db.prepare("UPDATE subscriptions SET plan_id=?,status='active',trial=0,current_period_start=?,current_period_end=?,cancel_at_period_end=0,period_tokens=?,period_payment_id=?,renewal_payment_id=NULL,version=version+1,updated_at=? WHERE id=?")
   .run(plan.id,now,now+PERIOD_DAYS*DAY,plan.monthlyTokens,paymentId,now,id);
  grantPeriod(db,{id,userId},now,plan.monthlyTokens,`${plan.name} 이용 기간 토큰`);
  return subscriptionById(db,id);
 };
 if(live&&live.currentPeriodEnd>now&&!live.trial){
  db.prepare('UPDATE subscriptions SET renewal_payment_id=?,cancel_at_period_end=0,version=version+1,updated_at=? WHERE id=?').run(paymentId,now,live.id);
  return subscriptionById(db,live.id);
 }
 if(live){expirePeriodTokens(db,live,now);return start(live.id);}
 const id=randomUUID();
 db.prepare("INSERT INTO subscriptions(id,user_id,plan_id,status,trial,current_period_start,current_period_end,created_at,updated_at) VALUES(?,?,?,'active',0,?,?,?,?)").run(id,userId,plan.id,now,now+1,now,now);
 return start(id);
}

/** 기간이 끝난 구독 처리(작업자가 주기 실행): 남은 기간 토큰 소멸 후 예약된 갱신이 있으면 다음 기간, 없으면 종료. */
export function rolloverSubscriptions(db:Database,now=Date.now()){
 const due=db.prepare("SELECT id FROM subscriptions WHERE status IN ('trialing','active') AND current_period_end<=? LIMIT 200").all(now) as {id:string}[];
 let ended=0,renewed=0;
 for(const {id} of due)transaction(db,()=>{
  const sub=subscriptionById(db,id);
  if(!['trialing','active'].includes(sub.status)||sub.currentPeriodEnd>now)return;
  expirePeriodTokens(db,sub,sub.currentPeriodEnd);
  const start=sub.currentPeriodEnd;
  if(sub.renewalPaymentId){
   const plan=db.prepare('SELECT p.monthly_tokens AS tokens,p.name FROM payments x JOIN plans p ON p.id=x.plan_id WHERE x.id=?').get(sub.renewalPaymentId) as {tokens:number;name:string};
   db.prepare("UPDATE subscriptions SET status='active',trial=0,current_period_start=?,current_period_end=?,period_tokens=?,period_payment_id=renewal_payment_id,renewal_payment_id=NULL,version=version+1,updated_at=? WHERE id=?")
    .run(start,start+PERIOD_DAYS*DAY,plan.tokens,now,id);
   grantPeriod(db,sub,start,plan.tokens,`${plan.name} 이용 기간 토큰`);
   renewed++;return;
  }
  db.prepare('UPDATE subscriptions SET status=?,ended_at=?,version=version+1,updated_at=? WHERE id=?').run(sub.cancelAtPeriodEnd?'canceled':'expired',sub.currentPeriodEnd,now,id);
  audit(db,null,'billing.subscription.end','subscription',id,{status:sub.cancelAtPeriodEnd?'canceled':'expired'});
  ended++;
 });
 return{ended,renewed};
}

/** 전액 환불된 결제가 산 기간을 끝낸다(트랜잭션 안). 갱신 예약분이면 예약만 취소. */
export function endPaidPeriod(db:Database,paymentId:string,now:number){
 const sub=db.prepare("SELECT id FROM subscriptions WHERE status IN ('trialing','active') AND (period_payment_id=? OR renewal_payment_id=?)").get(paymentId,paymentId) as {id:string}|undefined;
 if(!sub)return;
 const s=subscriptionById(db,sub.id);
 if(s.renewalPaymentId===paymentId){db.prepare('UPDATE subscriptions SET renewal_payment_id=NULL,version=version+1,updated_at=? WHERE id=?').run(now,s.id);return;}
 expirePeriodTokens(db,s,now);
 db.prepare("UPDATE subscriptions SET status='expired',ended_at=?,version=version+1,updated_at=? WHERE id=?").run(now,now,s.id);
}
