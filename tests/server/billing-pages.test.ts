import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {buildPricingPage} from '../../src/server/billing/pricing-page';
import {buildPaymentCompletePage} from '../../src/server/billing/payment-complete-page';
import {listPublicPlans} from '../../src/server/billing/plans';
import {startTrial,currentSubscription} from '../../src/server/billing/subscriptions';
import {createCheckout} from '../../src/server/billing/payments';
import type {CapturedNode} from '../../src/types/site';

type El=Exclude<CapturedNode,string>;
const all=(nodes:CapturedNode[],f:(n:El)=>boolean,out:El[]=[]):El[]=>{for(const n of nodes){if(typeof n==='string')continue;if(f(n))out.push(n);all(n.children,f,out);}return out;};
const text=(n:CapturedNode):string=>typeof n==='string'?n:n.children.map(text).join('');
const NOW=Date.parse('2026-10-14T03:00:00Z');
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const user=(await register(db,{email:'p@example.test',password:'pricing-long-password',nickname:'P',termsAccepted:true})).user.id;
 return{db,user};
}

test('pricing: plans are seeded from the captured cards once and drawn from the database',async t=>{
 const {db}=await fixture(t);
 const page=await buildPricingPage(db,null,false,NOW);
 const plans=listPublicPlans(db);
 assert.deepEqual(plans.map(p=>[p.code,p.monthlyTokens,p.trialDays]),[['free',0,0],['basic',750,7]]);
 const buttons=all(page.body,n=>n.attrs['data-plan-action']!==undefined);
 assert.deepEqual(buttons.map(b=>[b.attrs['data-plan-action'],text(b)]),[['free','무료로 시작하기'],['basic','7일 무료 체험']]);
 assert.equal(all(page.body,n=>(n.attrs.class??'').includes('MuiCard-root')).length,3,'the contact card stays');
 assert.match(text(all(page.body,n=>(n.attrs.class??'').includes('MuiAlert-message'))[0]),/미설정/);
 await buildPricingPage(db,null,false,NOW);
 assert.equal(listPublicPlans(db).length,2,'seed runs once');
});

test('pricing reflects my subscription; complete page shows the stored order, not the query',async t=>{
 const {db,user}=await fixture(t);
 await buildPricingPage(db,null,true,NOW);
 createBlog(db,user,{naverId:'p_blog',title:'P',category:'',isPrimary:true});
 startTrial(db,user,{planCode:'basic'},NOW);
 const page=await buildPricingPage(db,user,true,NOW);
 const basic=all(page.body,n=>n.attrs['data-plan-action']==='basic')[0];
 assert.equal(text(basic),'체험 중');assert.equal(basic.attrs.disabled,undefined,'trial members can still pay');
 assert.match(text(all(page.body,n=>(n.attrs.class??'').includes('MuiAlert-message'))[0]),/토스페이먼츠/);
 const failed=await buildPaymentCompletePage({payment:null,subscription:null,error:'카드사에서 거절했습니다.'});
 assert.equal(all(failed.body,n=>n.attrs['data-payment-result']==='error').length,1);
 assert.match(text(all(failed.body,n=>n.tag==='h5')[0]),/완료되지 않았어요/);
 const order=createCheckout(db,{name:'toss',clientKey:'ck',confirm:async()=>{throw new Error('x');},get:async()=>{throw new Error('x');},cancel:async()=>{throw new Error('x');}},user,{planCode:'basic'},NOW);
 const pending=db.prepare('SELECT * FROM payments WHERE order_id=?').get(order.orderId) as Record<string,unknown>;
 assert.equal(pending.status,'ready');
 const view=await buildPaymentCompletePage({payment:{status:'ready'} as never,subscription:currentSubscription(db,user,NOW),error:null});
 assert.match(text(all(view.body,n=>n.tag==='h5')[0]),/확인하는 중/);
});
