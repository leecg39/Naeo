import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createPlan} from '../../src/server/billing/plans';
import {balance} from '../../src/server/credits/ledger';
import {createCheckout,confirmPayment,handleTossWebhook,abandonCheckout,expireStalePayments,paymentForOwner,reconcilePayment,myPayments} from '../../src/server/billing/payments';
import {requestRefund,decideRefund,createAdminRefund,refundById} from '../../src/server/billing/refunds';
import {ProviderError,type PaymentProvider,type ProviderPayment} from '../../src/server/billing/provider';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {migrations} from '../../src/server/migrations';

const NOW=Date.parse('2026-10-14T03:00:00Z');
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const make=async(email:string)=>(await register(db,{email,password:'payment-race-test-password',nickname:'QA',termsAccepted:true})).user.id;
 const admin=await make('admin@example.test'),owner=await make('owner@example.test');
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);
 createPlan(db,admin,{code:'basic',name:'Basic',price:9900,monthlyTokens:750,trialDays:7});
 let response:ProviderPayment;
 const provider:PaymentProvider={name:'toss',clientKey:'fixture-client',
  async confirm(i){response={paymentKey:i.paymentKey,orderId:i.orderId,totalAmount:i.amount,balanceAmount:i.amount,status:'DONE',method:'카드',approvedAt:new Date(NOW).toISOString()};return{...response};},
  async get(){return{...response};},async cancel(_key,input){response={...response,balanceAmount:response.balanceAmount-input.amount,status:response.balanceAmount===input.amount?'CANCELED':'PARTIAL_CANCELED'};return{...response};}};
 const order=createCheckout(db,provider,owner,{planCode:'basic'},NOW);
 const input={paymentKey:'test-payment-key',orderId:order.orderId,amount:order.amount};
 const paid=()=>confirmPayment(db,provider,owner,input,NOW);
 return{db,admin,owner,provider,order,input,paid};
}

test('confirmation rejects a different payment key and preserves the mismatch for reconciliation',async t=>{
 const f=await fixture(t),confirm=f.provider.confirm;
 f.provider.confirm=async(i,k)=>({...await confirm(i,k),paymentKey:'a-different-payment'});
 await assert.rejects(f.paid(),{code:'PROVIDER_MISMATCH'});
 const p=paymentForOwner(f.db,f.owner,f.order.orderId);
 assert.equal(p.status,'ready');assert.equal(p.failureCode,'PROVIDER_MISMATCH');
 assert.equal(balance(f.db,f.owner),0);
});

test('an in-flight confirmation cannot be replaced, abandoned or locally expired',async t=>{
 const f=await fixture(t),confirm=f.provider.confirm;
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 f.provider.confirm=async(i,k)=>{await gate;return confirm(i,k);};
 const pending=f.paid();
 try{
  assert.throws(()=>createCheckout(f.db,f.provider,f.owner,{planCode:'basic'},NOW+1),{code:'PAYMENT_PROCESSING'});
  assert.equal(abandonCheckout(f.db,f.owner,f.order.orderId,{},NOW+1)?.status,'ready');
  assert.equal(expireStalePayments(f.db,NOW+31*60_000),0);
  await assert.rejects(confirmPayment(f.db,f.provider,f.owner,{...f.input,paymentKey:'other'},NOW+1),{code:'PAYMENT_KEY_CONFLICT'});
 }finally{release();await pending;}
 assert.equal(paymentForOwner(f.db,f.owner,f.order.orderId).status,'paid');assert.equal(balance(f.db,f.owner),750);
});

test('account deletion during confirmation preserves the financial result without recreating user data',async t=>{
 const f=await fixture(t),confirm=f.provider.confirm;
 f.provider.confirm=async(i,k)=>{const r=await confirm(i,k);f.db.prepare('DELETE FROM users WHERE id=?').run(f.owner);return r;};
 const p=await f.paid();assert.equal(p.status,'paid');assert.equal(p.userId,null);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM subscriptions').get()?.n,0);
});

test('webhooks cannot apply a snapshot belonging to a different payment key',async t=>{
 const f=await fixture(t);await f.paid();const get=f.provider.get;
 f.provider.get=async k=>({...await get(k),paymentKey:'other-key',status:'CANCELED',balanceAmount:0});
 const r=await handleTossWebhook(f.db,f.provider,{eventType:'PAYMENT_STATUS_CHANGED',createdAt:'one',data:{paymentKey:f.input.paymentKey}},NOW);
 assert.equal(r.result,'identity_mismatch');assert.equal(paymentForOwner(f.db,f.owner,f.order.orderId).status,'paid');
});

for(const kind of ['identity','insufficient','negative'] as const)test(`refund rejects ${kind} provider response without changing accounting`,async t=>{
 const f=await fixture(t),p=await f.paid(),r=requestRefund(f.db,f.owner,p.id,{reason:'QA'},NOW);
 f.provider.cancel=async()=>({paymentKey:f.input.paymentKey,orderId:kind==='identity'?'unrelated-order':p.orderId,totalAmount:p.amount,balanceAmount:kind==='insufficient'?9000:kind==='negative'?-100:0,status:'CANCELED',method:'카드',approvedAt:null});
 await assert.rejects(decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:r.version},NOW),{code:'REFUND_FAILED'});
 assert.equal(refundById(f.db,r.id).status,'failed');assert.equal(paymentForOwner(f.db,f.owner,p.orderId).canceledAmount,0);assert.equal(balance(f.db,f.owner),750);
});

test('an unexpected refund transport error is retryable with the original idempotency key',async t=>{
 const f=await fixture(t),p=await f.paid(),r=requestRefund(f.db,f.owner,p.id,{reason:'QA'},NOW),cancel=f.provider.cancel;
 const keys:string[]=[];f.provider.cancel=async(_p,_i,k)=>{keys.push(k);throw new Error('socket interrupted');};
 await assert.rejects(decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:r.version},NOW),{code:'REFUND_FAILED'});
 assert.equal(refundById(f.db,r.id).status,'failed');
 assert.throws(()=>requestRefund(f.db,f.owner,p.id,{reason:'second'},NOW),{code:'REFUND_PENDING'});
 f.provider.cancel=async(p,i,k)=>{keys.push(k);return cancel(p,i,k);};
 const done=await decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:refundById(f.db,r.id).version},NOW+1);
 assert.equal(done.status,'completed');assert.equal(new Set(keys).size,1);
});

test('a crashed refund can resume after its processing grace without opening a new refund',async t=>{
 const f=await fixture(t),p=await f.paid(),r=requestRefund(f.db,f.owner,p.id,{reason:'QA'},NOW);
 f.db.prepare("UPDATE refunds SET status='approved',decided_at=?,provider_started_at=?,cancel_base=0,version=version+1 WHERE id=?").run(NOW,NOW,r.id);
 await assert.rejects(decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:2},NOW+1),{code:'REFUND_PROCESSING'});
 const done=await decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:2},NOW+61_000);
 assert.equal(done.status,'completed');
});

test('an unconfigured admin refund does not leave an open request behind',async t=>{
 const f=await fixture(t),p=await f.paid();
 await assert.rejects(createAdminRefund(f.db,null,f.admin,p.id,{reason:'QA'},NOW),{code:'PAYMENT_PROVIDER_NOT_CONFIGURED'});
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM refunds').get()?.n,0);
});

test('an uncertain provider confirmation can be retried after the local order timeout',async t=>{
 const f=await fixture(t),confirm=f.provider.confirm;
 f.provider.confirm=async()=>{throw new ProviderError('PROVIDER_UNREACHABLE','try later',503);};
 await assert.rejects(f.paid(),{status:503});
 assert.equal(expireStalePayments(f.db,NOW+31*60_000),0);
 f.provider.confirm=confirm;
 assert.equal((await confirmPayment(f.db,f.provider,f.owner,f.input,NOW+31*60_000)).status,'paid');
});

test('uncertain confirmations are visible, reject another key and reconcile without a second charge',async t=>{
 const f=await fixture(t),confirm=f.provider.confirm;
 f.provider.confirm=async(i,k)=>{await confirm(i,k);throw new Error('response lost');};
 await assert.rejects(f.paid(),{status:503});
 assert.equal(myPayments(f.db,f.owner)[0].orderId,f.order.orderId);
 await assert.rejects(confirmPayment(f.db,f.provider,f.owner,{...f.input,paymentKey:'replacement'},NOW+1),{code:'PAYMENT_KEY_CONFLICT'});
 const p=await reconcilePayment(f.db,f.provider,myPayments(f.db,f.owner)[0].id,NOW+1);
 assert.equal(p.status,'paid');assert.equal(p.failureCode,'');assert.equal(balance(f.db,f.owner),750);
});

test('a cancellation webhook wins over an older confirmation response and does not leave tokens',async t=>{
 const f=await fixture(t),confirm=f.provider.confirm;
 f.provider.confirm=async(i,k)=>{
  const result=await confirm(i,k);await f.provider.cancel(i.paymentKey,{amount:i.amount,reason:'external'},'external');
  const hook=await handleTossWebhook(f.db,f.provider,{eventType:'PAYMENT_STATUS_CHANGED',createdAt:'race',data:{paymentKey:i.paymentKey}},NOW);
  assert.equal(hook.result,'canceled');return result;
 };
 assert.equal((await f.paid()).status,'canceled');assert.equal(balance(f.db,f.owner),0);
});

test('uncertain confirmations older than 15 days only query, never send another confirmation',async t=>{
 const f=await fixture(t),confirm=f.provider.confirm;let calls=0;
 f.provider.confirm=async(i,k)=>{calls++;await confirm(i,k);throw new Error('lost');};
 await assert.rejects(f.paid());
 assert.equal((await confirmPayment(f.db,f.provider,f.owner,f.input,NOW+15*86_400_000)).status,'paid');
 assert.equal(calls,1);
});

test('refund recovery keeps the baseline after a webhook and never re-cancels after 15 days',async t=>{
 const f=await fixture(t),p=await f.paid(),r=requestRefund(f.db,f.owner,p.id,{reason:'lost response'},NOW),cancel=f.provider.cancel;
 let calls=0;f.provider.cancel=async(key,input,idem)=>{calls++;await cancel(key,input,idem);throw new Error('lost response');};
 await assert.rejects(decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:1},NOW));
 await handleTossWebhook(f.db,f.provider,{eventType:'PAYMENT_STATUS_CHANGED',createdAt:'canceled',data:{paymentKey:p.paymentKey!}},NOW+1);
 const done=await decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:refundById(f.db,r.id).version},NOW+15*86_400_000);
 assert.equal(done.status,'completed');assert.equal(calls,1);assert.equal(balance(f.db,f.owner),0);
});

test('late failed refund response cannot overwrite a newer recovery that has completed',async t=>{
 const f=await fixture(t),p=await f.paid(),r=requestRefund(f.db,f.owner,p.id,{reason:'race'},NOW),cancel=f.provider.cancel;
 let fail!:()=>void;f.provider.cancel=async()=>{await new Promise<void>(resolve=>{fail=resolve;});throw new Error('late failure');};
 const first=decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:1},NOW);
 f.provider.cancel=cancel;
 assert.equal((await decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:2},NOW+61_000)).status,'completed');
 fail();assert.equal((await first).status,'completed');assert.equal(refundById(f.db,r.id).status,'completed');
});

test('failed refunds cannot be rejected to bypass the same-operation retry rule',async t=>{
 const f=await fixture(t),p=await f.paid(),r=requestRefund(f.db,f.owner,p.id,{reason:'uncertain'},NOW);
 f.provider.cancel=async()=>{throw new Error('offline');};
 await assert.rejects(decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:1},NOW));
 await assert.rejects(decideRefund(f.db,f.provider,f.admin,r.id,{decision:'rejected',version:3},NOW+1),{code:'REFUND_UNCERTAIN'});
 assert.throws(()=>f.db.prepare('UPDATE refunds SET amount=1 WHERE id=?').run(r.id),/immutable/);
 assert.throws(()=>createCheckout(f.db,f.provider,f.owner,{planCode:'basic'},NOW+1),{code:'ALREADY_SUBSCRIBED'});
});

test('refund completion remains recorded if the deciding administrator is deleted while awaiting the provider',async t=>{
 const f=await fixture(t),p=await f.paid(),r=requestRefund(f.db,f.owner,p.id,{reason:'deleted admin'},NOW),cancel=f.provider.cancel;
 f.provider.cancel=async(key,input,idem)=>{const result=await cancel(key,input,idem);f.db.prepare('DELETE FROM users WHERE id=?').run(f.admin);return result;};
 assert.equal((await decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:1},NOW)).status,'completed');
 assert.equal(balance(f.db,f.owner),0);
});

test('refund retries beyond 15 days cannot cancel again when a lookup has not confirmed the refund',async t=>{
 const f=await fixture(t),p=await f.paid(),r=requestRefund(f.db,f.owner,p.id,{reason:'offline'},NOW);let calls=0;
 f.provider.cancel=async()=>{calls++;throw new Error('offline');};
 await assert.rejects(decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:1},NOW));
 await assert.rejects(decideRefund(f.db,f.provider,f.admin,r.id,{decision:'approved',version:3},NOW+15*86_400_000),{code:'REFUND_FAILED'});
 assert.equal(calls,1);assert.equal(refundById(f.db,r.id).status,'failed');assert.equal(balance(f.db,f.owner),750);
});

test('schema 27 upgrade preserves legacy financial rows and does not invent a missing refund baseline',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'naeo-billing-upgrade-')),path=join(dir,'db.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const old=new DatabaseSync(path);
 old.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL) STRICT;');
 for(const m of migrations.filter(m=>m.version<=27)){old.exec(m.sql);old.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(m.version,m.name,createHash('sha256').update(m.sql).digest('hex'),NOW);}
 const {user}=await register(old,{email:'legacy@example.test',password:'payment-race-test-password',nickname:'이전 회원',termsAccepted:true});
 old.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
 const plan=createPlan(old,user.id,{code:'legacy',name:'이전 요금제',price:9900,monthlyTokens:750});
 old.prepare("INSERT INTO payments(id,user_id,order_id,order_name,plan_id,list_amount,amount,provider,status,payment_key,approved_at,expires_at,created_at,updated_at) VALUES('legacy-payment',?,'legacy-order','기존 결제',?,9900,9900,'toss','paid','legacy-key',?,?,?,?)").run(user.id,plan.id,NOW,NOW+1000,NOW,NOW);
 old.prepare("INSERT INTO refunds(id,payment_id,user_id,amount,reason,status,decided_at,created_at,updated_at) VALUES('legacy-refund','legacy-payment',?,9900,'기존 환불','approved',?,?,?)").run(user.id,NOW,NOW,NOW);old.close();
 const db=openDatabase(path);t.after(()=>db.close());
 assert.equal(db.prepare('SELECT amount FROM payments WHERE id=?').get('legacy-payment')?.amount,9900);
 assert.equal(refundById(db,'legacy-refund').cancelBase,null);
 const never=async()=>{assert.fail('legacy unresolved refunds must not invoke a payment API');};
 await assert.rejects(decideRefund(db,{name:'toss',clientKey:'local',get:never,confirm:never,cancel:never},user.id,'legacy-refund',{decision:'approved',version:1},NOW+61_000),{code:'REFUND_RECONCILIATION_REQUIRED'});
});
