import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {balance} from '../../src/server/credits/ledger';
import {createPlan} from '../../src/server/billing/plans';
import {createCoupon} from '../../src/server/billing/coupons';
import {currentSubscription,startTrial,rolloverSubscriptions} from '../../src/server/billing/subscriptions';
import {createCheckout,confirmPayment,handleTossWebhook,expireStalePayments,paymentForOwner} from '../../src/server/billing/payments';
import {requestRefund,decideRefund,createAdminRefund} from '../../src/server/billing/refunds';
import {ProviderError,type PaymentProvider,type ProviderPayment} from '../../src/server/billing/provider';

const NOW=Date.parse('2026-10-14T03:00:00Z');
const DAY=86_400_000;
type Fake=PaymentProvider&{calls:string[];payments:Map<string,ProviderPayment>;failConfirm?:string;failCancel?:string};
/** 토스 승인·조회·취소를 흉내 낸다. 같은 멱등 키는 같은 결과를 돌려준다. */
function fakeProvider():Fake{
 const payments=new Map<string,ProviderPayment>(),seen=new Map<string,ProviderPayment>();
 const fake:Fake={name:'toss',clientKey:'test_client_key_dummy',calls:[],payments,
  async confirm(i,key){
   fake.calls.push(`confirm:${key}`);
   if(seen.has(key))return seen.get(key)!;
   if(fake.failConfirm)throw new ProviderError(fake.failConfirm,'카드사에서 거절했습니다.',400);
   const p={paymentKey:i.paymentKey,orderId:i.orderId,status:'DONE',totalAmount:i.amount,balanceAmount:i.amount,method:'카드',approvedAt:new Date(NOW).toISOString()};
   payments.set(i.paymentKey,p);seen.set(key,p);return p;
  },
  async get(paymentKey){fake.calls.push(`get:${paymentKey}`);const p=payments.get(paymentKey);if(!p)throw new ProviderError('NOT_FOUND_PAYMENT','결제 없음',404);return{...p};},
  async cancel(paymentKey,i,key){
   fake.calls.push(`cancel:${key}`);
   if(fake.failCancel)throw new ProviderError(fake.failCancel,'취소 실패',400);
   if(seen.has(key))return seen.get(key)!;
   const p=payments.get(paymentKey)!;const next={...p,balanceAmount:p.balanceAmount-i.amount,status:p.balanceAmount-i.amount===0?'CANCELED':'PARTIAL_CANCELED'};
   payments.set(paymentKey,next);seen.set(key,next);return next;
  }};
 return fake;
}
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const mk=async(email:string)=>(await register(db,{email,password:'payments-long-password',nickname:email[0],termsAccepted:true})).user.id;
 const admin=await mk('admin@example.test'),a=await mk('a@example.test'),b=await mk('b@example.test');
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);
 createPlan(db,admin,{code:'basic',name:'베이직',price:9900,monthlyTokens:750,trialDays:7});
 createBlog(db,a,{naverId:'a_blog',title:'A',category:'',isPrimary:true});
 return{db,admin,a,b,provider:fakeProvider()};
}
const status=(db:ReturnType<typeof openDatabase>,orderId:string)=>(db.prepare('SELECT status FROM payments WHERE order_id=?').get(orderId) as {status:string}).status;
const coupon=(code:string,kind:string,value:number)=>({code,kind,value,startsAt:new Date(NOW-DAY).toISOString(),endsAt:new Date(NOW+30*DAY).toISOString()});

test('checkout: provider not configured is refused before anything is stored; a 100% coupon needs no provider',async t=>{
 const {db,admin,a}=await fixture(t);
 assert.throws(()=>createCheckout(db,null,a,{planCode:'basic'},NOW),{status:503,code:'PAYMENT_PROVIDER_NOT_CONFIGURED'});
 assert.equal((db.prepare('SELECT count(*) AS n FROM payments').get() as {n:number}).n,0);
 createCoupon(db,admin,coupon('FREEMONTH','percent_off',100));
 const free=createCheckout(db,null,a,{planCode:'basic',couponCode:'freemonth'},NOW);
 assert.equal(free.amount,0);assert.equal(free.status,'paid');
 assert.equal(currentSubscription(db,a,NOW)?.status,'active');
 assert.equal(balance(db,a),750);
 assert.equal((db.prepare("SELECT status FROM coupon_redemptions").get() as {status:string}).status,'used');
});

test('confirm: server amount wins, tampering fails and frees the coupon, trial converts to paid',async t=>{
 const {db,admin,a,provider}=await fixture(t);
 startTrial(db,a,{planCode:'basic'},NOW);
 assert.equal(balance(db,a),175);
 createCoupon(db,admin,coupon('OFF20','percent_off',20));
 const order=createCheckout(db,provider,a,{planCode:'basic',couponCode:'OFF20'},NOW);
 assert.deepEqual([order.listAmount,order.amount,order.clientKey],[9900,7920,'test_client_key_dummy']);
 await assert.rejects(confirmPayment(db,provider,a,{paymentKey:'pk_1',orderId:order.orderId,amount:100},NOW),{status:400,code:'AMOUNT_MISMATCH'});
 assert.equal(status(db,order.orderId),'failed');
 assert.equal(provider.calls.length,0,'tampered amounts never reach the provider');
 const again=createCheckout(db,provider,a,{planCode:'basic',couponCode:'OFF20'},NOW+1000);
 assert.equal(again.amount,7920,'released coupon can be used again');
 await assert.rejects(confirmPayment(db,provider,'other-user',{paymentKey:'pk_2',orderId:again.orderId,amount:7920},NOW),{status:404});
 const paid=await confirmPayment(db,provider,a,{paymentKey:'pk_2',orderId:again.orderId,amount:7920},NOW+2000);
 assert.equal(paid.status,'paid');assert.equal(paid.method,'카드');
 const sub=currentSubscription(db,a,NOW+3000)!;
 assert.equal(sub.trial,false);assert.equal(sub.currentPeriodEnd-sub.currentPeriodStart,30*DAY);
 assert.equal(balance(db,a),750,'unused trial tokens expire, the paid period grants 750');
 assert.equal(paymentForOwner(db,a,again.orderId).status,'paid');
});

test('double confirm and provider failures are safe',async t=>{
 const {db,b,provider}=await fixture(t);
 const order=createCheckout(db,provider,b,{planCode:'basic'},NOW);
 const both=await Promise.all([0,1].map(()=>confirmPayment(db,provider,b,{paymentKey:'pk_d',orderId:order.orderId,amount:9900},NOW)));
 assert.deepEqual(both.map(p=>p.status),['paid','paid']);
 assert.equal(new Set(provider.calls).size,1,'same idempotency key for both calls');
 assert.equal(balance(db,b),750,'tokens granted once');
 await assert.rejects(confirmPayment(db,provider,b,{paymentKey:'pk_other',orderId:order.orderId,amount:9900},NOW),{status:409,code:'ORDER_ALREADY_PAID'});
 const failing=fakeProvider();failing.failConfirm='REJECT_CARD_COMPANY';
 const {db:db2,b:b2}=await fixture(t);
 const o2=createCheckout(db2,failing,b2,{planCode:'basic'},NOW);
 await assert.rejects(confirmPayment(db2,failing,b2,{paymentKey:'pk_f',orderId:o2.orderId,amount:9900},NOW),{status:402,code:'PAYMENT_FAILED'});
 assert.equal(status(db2,o2.orderId),'failed');
 assert.equal(paymentForOwner(db2,b2,o2.orderId).failureCode,'REJECT_CARD_COMPANY');
 const o3=createCheckout(db2,failing,b2,{planCode:'basic'},NOW);
 assert.equal(expireStalePayments(db2,NOW+31*60_000),1);
 assert.equal(status(db2,o3.orderId),'expired');
});

test('webhook: re-queries the provider, ignores duplicates, unknown orders and lies in the payload',async t=>{
 const {db,a,b,provider}=await fixture(t);
 const order=createCheckout(db,provider,b,{planCode:'basic'},NOW);
 await provider.confirm({paymentKey:'pk_w',orderId:order.orderId,amount:9900},'from-success-page-never-reached');
 const event={eventType:'PAYMENT_STATUS_CHANGED',createdAt:'2026-10-14T12:00:00.000',data:{paymentKey:'pk_w',orderId:order.orderId,status:'DONE'}};
 assert.equal((await handleTossWebhook(db,provider,event,NOW)).result,'paid','user closed the browser before the success page');
 assert.equal((await handleTossWebhook(db,provider,event,NOW)).result,'duplicate');
 assert.equal(balance(db,b),750);
 const other=createCheckout(db,provider,a,{planCode:'basic'},NOW+1);
 const lie={...event,createdAt:'2026-10-14T12:01:00.000',data:{paymentKey:'pk_w',orderId:other.orderId,status:'DONE'}};
 assert.equal((await handleTossWebhook(db,provider,lie,NOW)).result,'noop','payload order id is not trusted; provider says pk_w belongs to the first order');
 assert.equal(status(db,other.orderId),'ready');
 provider.payments.set('pk_x',{paymentKey:'pk_x',orderId:'unknown-order-1',status:'DONE',totalAmount:9900,balanceAmount:9900,method:'카드',approvedAt:null});
 assert.equal((await handleTossWebhook(db,provider,{...event,createdAt:'x2',data:{paymentKey:'pk_x',orderId:'unknown-order-1',status:'DONE'}},NOW)).result,'unknown_order');
 provider.payments.set('pk_m',{paymentKey:'pk_m',orderId:other.orderId,status:'DONE',totalAmount:10,balanceAmount:10,method:'카드',approvedAt:null});
 assert.equal((await handleTossWebhook(db,provider,{...event,createdAt:'x3',data:{paymentKey:'pk_m',orderId:other.orderId,status:'DONE'}},NOW)).result,'amount_mismatch');
 assert.equal(status(db,other.orderId),'ready');
 await assert.rejects(handleTossWebhook(db,provider,{eventType:'PAYMENT_STATUS_CHANGED'},NOW),{name:'ZodError'});
});

test('refunds: 7-day window, admin approval cancels at the provider once, ends the period and expires unused tokens',async t=>{
 const {db,admin,b,provider}=await fixture(t);
 const order=createCheckout(db,provider,b,{planCode:'basic'},NOW);
 const paid=await confirmPayment(db,provider,b,{paymentKey:'pk_r',orderId:order.orderId,amount:9900},NOW);
 assert.throws(()=>requestRefund(db,b,paid.id,{reason:'안 써요'},NOW+8*DAY),{status:409,code:'REFUND_WINDOW_CLOSED'});
 const r=requestRefund(db,b,paid.id,{reason:'안 써요'},NOW+DAY);
 assert.throws(()=>requestRefund(db,b,paid.id,{reason:'또'},NOW+DAY),{status:409,code:'REFUND_PENDING'});
 provider.failCancel='PROVIDER_ERROR';
 await assert.rejects(decideRefund(db,provider,admin,r.id,{decision:'approved',version:1},NOW+DAY),{status:502,code:'REFUND_FAILED'});
 provider.failCancel=undefined;
 const done=await decideRefund(db,provider,admin,r.id,{decision:'approved',version:3},NOW+DAY);
 assert.equal(done.status,'completed');
 assert.equal(status(db,order.orderId),'canceled');
 assert.equal(currentSubscription(db,b,NOW+DAY),null);
 assert.equal(balance(db,b),0,'unused period tokens expire with the refund');
 assert.equal(provider.calls.filter(c=>c.startsWith('cancel:')).length,2,'failed attempt + retry with the same idempotency key');
 assert.equal(new Set(provider.calls.filter(c=>c.startsWith('cancel:'))).size,1);
 await assert.rejects(decideRefund(db,provider,admin,r.id,{decision:'approved',version:4},NOW+DAY),{status:409});
 await assert.rejects(createAdminRefund(db,provider,admin,paid.id,{reason:'중복'},NOW+DAY),{status:409,code:'NOTHING_TO_REFUND'});
});

test('renewal: early payment refused, last-3-days payment queues the next period',async t=>{
 const {db,b,provider}=await fixture(t);
 const first=createCheckout(db,provider,b,{planCode:'basic'},NOW);
 await confirmPayment(db,provider,b,{paymentKey:'pk_a',orderId:first.orderId,amount:9900},NOW);
 assert.throws(()=>createCheckout(db,provider,b,{planCode:'basic'},NOW+DAY),{status:409,code:'ALREADY_SUBSCRIBED'});
 const renew=createCheckout(db,provider,b,{planCode:'basic'},NOW+28*DAY);
 await confirmPayment(db,provider,b,{paymentKey:'pk_b',orderId:renew.orderId,amount:9900},NOW+28*DAY);
 assert.throws(()=>createCheckout(db,provider,b,{planCode:'basic'},NOW+29*DAY),{status:409,code:'RENEWAL_ALREADY_PAID'});
 assert.equal(balance(db,b),750,'renewal tokens wait for the next period');
 assert.deepEqual(rolloverSubscriptions(db,NOW+30*DAY),{ended:0,renewed:1});
 const sub=currentSubscription(db,b,NOW+30*DAY)!;
 assert.equal(sub.currentPeriodStart,NOW+30*DAY);
 assert.equal(balance(db,b),750,'old period tokens expired, new period granted');
});

test('accounting records are protected',async t=>{
 const {db,b,provider}=await fixture(t);
 const order=createCheckout(db,provider,b,{planCode:'basic'},NOW);
 await confirmPayment(db,provider,b,{paymentKey:'pk_z',orderId:order.orderId,amount:9900},NOW);
 assert.throws(()=>db.prepare('DELETE FROM payments').run(),/accounting records/);
 assert.throws(()=>db.prepare('UPDATE payments SET amount=1').run(),/immutable/);
 db.prepare('DELETE FROM users WHERE id=?').run(b);
 assert.equal((db.prepare('SELECT count(*) AS n FROM payments WHERE user_id IS NULL').get() as {n:number}).n,1,'payments outlive the account');
});

test('admin billing pagination: 101 tied payments/refunds, page two decision and filtered recovery',async t=>{
 const {listAdminPayments}=await import('../../src/server/billing/payments');
 const {listAdminRefunds}=await import('../../src/server/billing/refunds');
 const {loadValidPage}=await import('../../src/components/admin/pagination');
 const {db,admin,a,b}=await fixture(t);
 const plan=db.prepare("SELECT id FROM plans WHERE code='basic'").get() as {id:string};
 // Historical paid orders, all with the same timestamp, isolate pagination from provider setup.
 const insert=db.prepare("INSERT INTO payments(id,user_id,order_id,order_name,plan_id,list_amount,amount,provider,status,approved_at,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,9900,9900,'toss','paid',?,?,?,?)");
 for(let i=0;i<101;i++){
  const id=`page-payment-${String(i).padStart(3,'0')}`;
  insert.run(id,a,`page-order-${String(i).padStart(3,'0')}`,'페이지 검증',plan.id,NOW,NOW+DAY,NOW,NOW);
  requestRefund(db,a,id,{reason:'페이지 검증 환불'},NOW);
 }
 const payments=listAdminPayments(db,admin,{page:1,pageSize:100,status:'paid'});
 const last=listAdminPayments(db,admin,{page:2,pageSize:100,status:'paid'});
 assert.equal(last.data[0].id,'page-payment-100');
 assert.equal(new Set([...payments.data,...last.data].map(p=>p.id)).size,101);
 assert.equal(listAdminPayments(db,admin,{q:last.data[0].orderId}).pagination.total,1);
 const firstRefunds=listAdminRefunds(db,admin,{page:1,pageSize:100,status:'requested'});
 const lastRefunds=listAdminRefunds(db,admin,{page:2,pageSize:100,status:'requested'});
 assert.equal(new Set([...firstRefunds.data,...lastRefunds.data].map(r=>r.id)).size,101);
 const r=lastRefunds.data[0];
 await decideRefund(db,null,admin,r.id,{decision:'rejected',note:'심사 완료',version:r.version},NOW+1);
 const recovered=await loadValidPage(async page=>listAdminRefunds(db,admin,{page,pageSize:100,status:'requested'}),2);
 assert.equal(recovered.pagination.page,1);assert.equal(recovered.pagination.total,100);
 assert.equal(listAdminRefunds(db,admin,{status:'rejected'}).data[0].decisionNote,'심사 완료');
 assert.equal(listAdminPayments(db,admin,{status:'paid'}).pagination.total,101,'rejection does not change accounting');
 assert.throws(()=>listAdminPayments(db,b,{page:2}),{status:403});
 assert.throws(()=>listAdminRefunds(db,b,{page:2}),{status:403});
});
