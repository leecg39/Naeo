import {billingHistory} from './history';
import {z} from 'zod';
import type {Database} from '../database';
import {requireAdmin,type User} from '../auth';
import {AppError} from '../errors';
import {body,clientPeer,json,rateLimit} from '../http';
import {createPlan,deletePlan,listAdminPlans,listPublicPlans,updatePlan} from './plans';
import {createCoupon,listAdminCoupons,redeemCoupon,updateCoupon} from './coupons';
import {cancelSubscription,currentSubscription,resumeSubscription,startTrial} from './subscriptions';
import {confirmPayment,createCheckout,handleTossWebhook,listAdminPayments,paymentForOwner} from './payments';
import {createAdminRefund,decideRefund,listAdminRefunds,requestRefund} from './refunds';
import {reconcilePayment} from './payments';
import {userById} from '../auth';
import {tossProvider} from './provider';
import {seedPlans} from './seed';

const anyJson=z.unknown();
const ID='([a-f0-9-]{36})';
const match=(path:string,pattern:string)=>path.match(new RegExp(`^${pattern}$`));
export const WEBHOOK_PATH='/api/billing/webhooks/toss';

/** 로그인 없이: 판매 요금제와 결제 설정 여부, 토스 웹훅(Origin 없음·본문 불신·공급자 재조회). */
export async function publicBillingApi(db:Database,request:Request):Promise<Response|null>{
 const {pathname:path}=new URL(request.url),method=request.method;
 if(path==='/api/billing/plans'&&method==='GET'){await seedPlans(db);return json({data:listPublicPlans(db),paymentsConfigured:tossProvider()!==null});}
 if(path===WEBHOOK_PATH&&method==='POST'){
  rateLimit(db,`webhook:${clientPeer(request)}`,600,15*60*1000);
  return json({data:await handleTossWebhook(db,tossProvider(),await body(request,anyJson,64*1024))});
 }
 return null;
}

/** 회원: 내 구독·결제·환불, 체험·해지·재개, 쿠폰, 주문·승인, 환불 요청. */
export async function memberBillingApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path}=new URL(request.url),method=request.method;
 if(!path.startsWith('/api/billing/'))return null;
 if(method!=='GET')rateLimit(db,`billing:${user.id}`,60,15*60*1000);
 const input=()=>body(request,anyJson);
 if(path==='/api/billing/me'&&method==='GET')return json({data:{subscription:currentSubscription(db,user.id),...billingHistory(db,user.id,Object.fromEntries(new URL(request.url).searchParams)),paymentsConfigured:tossProvider()!==null}});
 if(path==='/api/billing/trial'&&method==='POST')return json({data:startTrial(db,user.id,await input())},201);
 if(path==='/api/billing/subscription/cancel'&&method==='POST')return json({data:cancelSubscription(db,user.id,await input())});
 if(path==='/api/billing/subscription/resume'&&method==='POST')return json({data:resumeSubscription(db,user.id,await input())});
 if(path==='/api/billing/coupons/redeem'&&method==='POST')return json({data:redeemCoupon(db,user.id,await input())});
 if(path==='/api/billing/checkout'&&method==='POST')return json({data:createCheckout(db,tossProvider(),user.id,await input())},201);
 if(path==='/api/billing/confirm'&&method==='POST')return json({data:await confirmPayment(db,tossProvider(),user.id,await input())});
 const order=match(path,'/api/billing/payments/([A-Za-z0-9_-]{6,64})');
 if(order&&method==='GET')return json({data:paymentForOwner(db,user.id,order[1])});
 const recheck=match(path,'/api/billing/payments/([A-Za-z0-9_-]{6,64})/reconcile');
 if(recheck&&method==='POST')return json({data:await reconcilePayment(db,tossProvider(),paymentForOwner(db,user.id,recheck[1]).id)});
 const refund=match(path,`/api/billing/payments/${ID}/refund`);
 if(refund&&method==='POST')return json({data:requestRefund(db,user.id,refund[1],await input())},201);
 return null;
}

/** 관리자: 요금제·쿠폰 CRUD, 결제 내역·직접 환불, 환불 요청 결정. */
export async function adminBillingApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 if(!['/api/admin/plans','/api/admin/coupons','/api/admin/payments','/api/admin/refunds'].some(p=>path===p||path.startsWith(p+'/')))return null;
 requireAdmin(user);
 if(method!=='GET')rateLimit(db,`admin-billing:${user.id}`,300,15*60*1000);
 const query=Object.fromEntries(searchParams),input=()=>body(request,anyJson);
 if(path==='/api/admin/plans'){
  if(method==='GET')return json({data:listAdminPlans(db,user.id)});
  if(method==='POST')return json({data:createPlan(db,user.id,await input())},201);
 }
 const plan=match(path,`/api/admin/plans/${ID}`);
 if(plan&&method==='PATCH')return json({data:updatePlan(db,user.id,plan[1],await input())});
 if(plan&&method==='DELETE')return json({data:deletePlan(db,user.id,plan[1],await input())});
 if(path==='/api/admin/coupons'){
  if(method==='GET')return json(listAdminCoupons(db,user.id,query));
  if(method==='POST')return json({data:createCoupon(db,user.id,await input())},201);
 }
 const coupon=match(path,`/api/admin/coupons/${ID}`);
 if(coupon&&method==='PATCH')return json({data:updateCoupon(db,user.id,coupon[1],await input())});
 if(path==='/api/admin/payments'&&method==='GET')return json(listAdminPayments(db,user.id,query));
 const recheck=match(path,`/api/admin/payments/${ID}/reconcile`);
 if(recheck&&method==='POST'){requireAdmin(userById(db,user.id));return json({data:await reconcilePayment(db,tossProvider(),recheck[1])});}
 const pay=match(path,`/api/admin/payments/${ID}/refund`);
 if(pay&&method==='POST')return json({data:await createAdminRefund(db,tossProvider(),user.id,pay[1],await input())},201);
 if(path==='/api/admin/refunds'&&method==='GET')return json(listAdminRefunds(db,user.id,query));
 const decide=match(path,`/api/admin/refunds/${ID}/decide`);
 if(decide&&method==='POST')return json({data:await decideRefund(db,tossProvider(),user.id,decide[1],await input())});
 throw new AppError(404,'NOT_FOUND','요청한 API를 찾을 수 없습니다.');
}
