import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {record} from '../credits/ledger';
import {couponQueryInput,createCouponInput,redeemInput,updateCouponInput} from './validation';
import type {Plan} from './plans';

export type CouponKind='tokens'|'percent_off'|'amount_off';
export type Coupon={id:string;code:string;kind:CouponKind;value:number;planId:string|null;planCode:string|null;maxRedemptions:number|null;startsAt:number;endsAt:number;status:'active'|'disabled';note:string;version:number;createdAt:number;updatedAt:number;redemptions:number};
const SELECT=`SELECT c.id,c.code,c.kind,c.value,c.plan_id AS planId,p.code AS planCode,c.max_redemptions AS maxRedemptions,c.starts_at AS startsAt,c.ends_at AS endsAt,c.status,c.note,c.version,c.created_at AS createdAt,c.updated_at AS updatedAt,
 (SELECT count(*) FROM coupon_redemptions r WHERE r.coupon_id=c.id AND r.status<>'released') AS redemptions FROM coupons c LEFT JOIN plans p ON p.id=c.plan_id`;
const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));
const normalize=(code:string)=>code.trim().toUpperCase();

export function couponById(db:Database,id:string):Coupon{
 const c=db.prepare(`${SELECT} WHERE c.id=?`).get(id) as Coupon|undefined;
 if(!c)throw new AppError(404,'NOT_FOUND','쿠폰을 찾을 수 없습니다.');
 return{...c};
}
function planIdOf(db:Database,code:string|null):string|null{
 if(!code)return null;
 const p=db.prepare('SELECT id FROM plans WHERE code=?').get(code) as {id:string}|undefined;
 if(!p)throw new AppError(404,'PLAN_NOT_FOUND','연결할 요금제를 찾을 수 없습니다.');
 return p.id;
}

export function listAdminCoupons(db:Database,actorId:string,query:unknown){
 authorize(db,actorId);
 const {page,pageSize,q,status}=couponQueryInput.parse(query);
 const like=`%${q.toUpperCase().replace(/[\\%_]/g,v=>'\\'+v)}%`;
 const where=["(c.code LIKE ? ESCAPE '\\' OR c.note LIKE ? ESCAPE '\\')"],params:(string|number)[]=[like,`%${q}%`];
 if(status){where.push('c.status=?');params.push(status);}
 const sql=`WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total FROM coupons c ${sql}`).get(...params) as {total:number};
 const rows=db.prepare(`${SELECT} ${sql} ORDER BY c.created_at DESC, c.id ASC LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as Coupon[];
 return{data:rows.map(r=>({...r})),pagination:{page,pageSize,total}};
}
export function createCoupon(db:Database,actorId:string,input:unknown):Coupon{
 authorize(db,actorId);
 const v=createCouponInput.parse(input);
 const id=randomUUID(),now=Date.now();
 return transaction(db,()=>{
  if(db.prepare('SELECT 1 FROM coupons WHERE code=?').get(v.code))throw new AppError(409,'CODE_EXISTS','이미 있는 쿠폰 코드입니다.');
  db.prepare('INSERT INTO coupons(id,code,kind,value,plan_id,max_redemptions,starts_at,ends_at,status,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(id,v.code,v.kind,v.value,planIdOf(db,v.planCode),v.maxRedemptions,v.startsAt,v.endsAt,v.status,v.note,now,now);
  audit(db,actorId,'admin.coupon.create','coupon',id,{code:v.code,kind:v.kind,value:v.value});
  return couponById(db,id);
 });
}
/** 코드·종류·값은 사용 기록과 맞아야 해서 바꾸지 않는다(상태·메모·한도·종료만). */
export function updateCoupon(db:Database,actorId:string,id:string,input:unknown):Coupon{
 authorize(db,actorId);
 const {version,...changes}=updateCouponInput.parse(input);
 return transaction(db,()=>{
  const c=couponById(db,id);
  if(c.version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  const endsAt=changes.endsAt??c.endsAt;
  if(endsAt<=c.startsAt)throw new AppError(400,'INVALID_PERIOD','종료 시각은 시작 시각보다 늦어야 합니다.');
  const max=changes.maxRedemptions===undefined?c.maxRedemptions:changes.maxRedemptions;
  db.prepare('UPDATE coupons SET status=?,note=?,max_redemptions=?,ends_at=?,version=version+1,updated_at=? WHERE id=? AND version=?')
   .run(changes.status??c.status,changes.note??c.note,max,endsAt,Date.now(),id,version);
  audit(db,actorId,'admin.coupon.update','coupon',id,{fields:Object.keys(changes)});
  return couponById(db,id);
 });
}

/** 사용할 수 있는 쿠폰인지 확인(트랜잭션 안). 상태·기간·회원당 1회·총 한도. */
function usable(db:Database,userId:string,rawCode:string,now:number):Coupon{
 const row=db.prepare('SELECT id FROM coupons WHERE code=?').get(normalize(rawCode)) as {id:string}|undefined;
 if(!row)throw new AppError(404,'COUPON_NOT_FOUND','쿠폰 코드를 찾을 수 없습니다.');
 const c=couponById(db,row.id);
 if(c.status!=='active'||now<c.startsAt||now>=c.endsAt)throw new AppError(409,'COUPON_NOT_ACTIVE','지금은 사용할 수 없는 쿠폰입니다.');
 if(db.prepare("SELECT 1 FROM coupon_redemptions WHERE coupon_id=? AND user_id=? AND status<>'released'").get(c.id,userId))throw new AppError(409,'COUPON_ALREADY_USED','이미 사용한 쿠폰입니다.');
 if(c.maxRedemptions!==null&&c.redemptions>=c.maxRedemptions)throw new AppError(409,'COUPON_EXHAUSTED','준비된 수량이 모두 사용된 쿠폰입니다.');
 return c;
}

/** 토큰 쿠폰 사용: 원장에 한 번 지급. 할인 쿠폰은 결제할 때만 쓸 수 있다. */
export function redeemCoupon(db:Database,userId:string,input:unknown,now=Date.now()){
 const {code}=redeemInput.parse(input);
 return transaction(db,()=>{
  const c=usable(db,userId,code,now);
  if(c.kind!=='tokens')throw new AppError(400,'COUPON_CHECKOUT_ONLY','결제할 때 적용하는 할인 쿠폰입니다.');
  const id=randomUUID();
  db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,user_id,status,created_at,updated_at) VALUES(?,?,?,'used',?,?)").run(id,c.id,userId,now,now);
  record(db,{ownerId:userId,delta:c.value,reason:'coupon',refType:'coupon',refId:id,note:`쿠폰 ${c.code}`},now);
  audit(db,userId,'billing.coupon.redeem','coupon',c.id,{tokens:c.value});
  return{code:c.code,tokens:c.value};
 });
}

/** 결제 쿠폰 예약(트랜잭션 안): 할인액과 예약 id. 결제 실패·만료 시 release, 승인 시 markUsed. */
export function reserveDiscount(db:Database,userId:string,rawCode:string,plan:Plan,now:number):{redemptionId:string;discount:number;code:string}{
 const c=usable(db,userId,rawCode,now);
 if(c.kind==='tokens')throw new AppError(400,'COUPON_NOT_DISCOUNT','토큰 쿠폰은 설정 화면에서 사용해주세요.');
 if(c.planId&&c.planId!==plan.id)throw new AppError(409,'COUPON_PLAN_MISMATCH','이 요금제에는 쓸 수 없는 쿠폰입니다.');
 const discount=Math.min(plan.price,c.kind==='percent_off'?Math.floor(plan.price*c.value/100):c.value);
 const id=randomUUID();
 db.prepare("INSERT INTO coupon_redemptions(id,coupon_id,user_id,status,created_at,updated_at) VALUES(?,?,?,'reserved',?,?)").run(id,c.id,userId,now,now);
 return{redemptionId:id,discount,code:c.code};
}
export function settleRedemption(db:Database,redemptionId:string|null,status:'used'|'released',paymentId:string,now:number){
 if(redemptionId)db.prepare("UPDATE coupon_redemptions SET status=?,payment_id=?,updated_at=? WHERE id=? AND status='reserved'").run(status,paymentId,now,redemptionId);
}
