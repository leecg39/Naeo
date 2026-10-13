import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput} from '../validation';
import {createPlanInput,updatePlanInput} from './validation';

export type Plan={id:string;code:string;name:string;description:string;price:number;monthlyTokens:number;trialDays:number;status:'active'|'hidden';position:number;version:number;createdAt:number;updatedAt:number};
const SELECT='SELECT id,code,name,description,price_krw AS price,monthly_tokens AS monthlyTokens,trial_days AS trialDays,status,position,version,created_at AS createdAt,updated_at AS updatedAt FROM plans';
const COLUMNS={code:'code',name:'name',description:'description',price:'price_krw',monthlyTokens:'monthly_tokens',trialDays:'trial_days',status:'status',position:'position'} as const;
type Field=keyof typeof COLUMNS;
const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));
const plain=(p:Plan):Plan=>({...p});

export function planById(db:Database,id:string):Plan{
 const p=db.prepare(`${SELECT} WHERE id=?`).get(id) as Plan|undefined;
 if(!p)throw new AppError(404,'NOT_FOUND','요금제를 찾을 수 없습니다.');
 return plain(p);
}
/** 공개 판매 중인 요금제만(숨김 제외). 없으면 404. */
export function activePlan(db:Database,code:string):Plan{
 const p=db.prepare(`${SELECT} WHERE code=? AND status='active'`).get(code) as Plan|undefined;
 if(!p)throw new AppError(404,'PLAN_NOT_FOUND','판매 중인 요금제를 찾을 수 없습니다.');
 return plain(p);
}
export const listPublicPlans=(db:Database):Plan[]=>(db.prepare(`${SELECT} WHERE status='active' ORDER BY position,price_krw,created_at`).all() as Plan[]).map(plain);
export function listAdminPlans(db:Database,actorId:string):Plan[]{
 authorize(db,actorId);
 return (db.prepare(`${SELECT} ORDER BY position,price_krw,created_at`).all() as Plan[]).map(plain);
}
function assertCodeFree(db:Database,code:string,id:string){
 if(db.prepare('SELECT 1 FROM plans WHERE code=? AND id<>?').get(code,id))throw new AppError(409,'CODE_EXISTS','이미 사용 중인 코드입니다.');
}

export function createPlan(db:Database,actorId:string,input:unknown):Plan{
 authorize(db,actorId);
 const v=createPlanInput.parse(input);
 const id=randomUUID(),now=Date.now();
 return transaction(db,()=>{
  assertCodeFree(db,v.code,id);
  db.prepare('INSERT INTO plans(id,code,name,description,price_krw,monthly_tokens,trial_days,status,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
   .run(id,v.code,v.name,v.description,v.price,v.monthlyTokens,v.trialDays,v.status,v.position,now,now);
  audit(db,actorId,'admin.plan.create','plan',id,{code:v.code,price:v.price});
  return planById(db,id);
 });
}
/** 가격·지급 토큰을 바꿔도 이미 결제한 주문 금액과 진행 중인 기간 지급량은 바뀌지 않는다(주문·구독에 따로 기록). */
export function updatePlan(db:Database,actorId:string,id:string,input:unknown):Plan{
 authorize(db,actorId);
 const {version,...changes}=updatePlanInput.parse(input);
 return transaction(db,()=>{
  if(planById(db,id).version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  if(changes.code)assertCodeFree(db,changes.code,id);
  const keys=Object.keys(changes) as Field[];
  db.prepare(`UPDATE plans SET ${keys.map(k=>COLUMNS[k]+'=?').join(',')},version=version+1,updated_at=? WHERE id=? AND version=?`)
   .run(...keys.map(k=>changes[k] as string|number),Date.now(),id,version);
  audit(db,actorId,'admin.plan.update','plan',id,{fields:keys});
  return planById(db,id);
 });
}
/** 구독·결제에 쓰인 요금제는 회계 기록을 위해 지우지 않고 숨김으로 바꾸게 한다. */
export function deletePlan(db:Database,actorId:string,id:string,input:unknown){
 authorize(db,actorId);
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  if(planById(db,id).version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  if(db.prepare('SELECT 1 FROM subscriptions WHERE plan_id=? UNION SELECT 1 FROM payments WHERE plan_id=?').get(id,id))throw new AppError(409,'PLAN_IN_USE','구독·결제 기록이 있는 요금제는 삭제할 수 없습니다. 숨김으로 바꿔주세요.');
  db.prepare('UPDATE coupons SET plan_id=NULL WHERE plan_id=?').run(id);
  db.prepare('DELETE FROM plans WHERE id=?').run(id);
  audit(db,actorId,'admin.plan.delete','plan',id);
  return{deleted:true};
 });
}
