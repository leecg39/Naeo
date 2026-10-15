import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {balance,record} from '../../src/server/credits/ledger';
import {createPlan,updatePlan,deletePlan,listPublicPlans,listAdminPlans} from '../../src/server/billing/plans';
import {createCoupon,updateCoupon,listAdminCoupons,redeemCoupon} from '../../src/server/billing/coupons';
import {currentSubscription,startTrial,cancelSubscription,resumeSubscription,rolloverSubscriptions} from '../../src/server/billing/subscriptions';

const NOW=Date.parse('2026-10-14T03:00:00Z');
const DAY=86_400_000;
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const mk=async(email:string,nickname:string)=>(await register(db,{email,password:'billing-long-password',nickname,termsAccepted:true})).user.id;
 const admin=await mk('admin@example.test','관리자'),a=await mk('a@example.test','A'),b=await mk('b@example.test','B');
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);
 const plan=createPlan(db,admin,{code:'basic',name:'베이직',price:9900,monthlyTokens:750,trialDays:7});
 return{db,admin,a,b,plan,mk};
}
const coupon=(over:Record<string,unknown>={})=>({code:'welcome10',kind:'tokens',value:10,startsAt:new Date(NOW-DAY).toISOString(),endsAt:new Date(NOW+30*DAY).toISOString(),...over});
const audits=(db:Database,action:string)=>(db.prepare('SELECT count(*) AS n FROM audit_logs WHERE action=?').get(action) as {n:number}).n;

test('plans: admin CRUD, public list hides hidden plans, plans in use cannot be deleted',async t=>{
 const {db,admin,a,plan}=await fixture(t);
 assert.throws(()=>createPlan(db,a,{code:'x1',name:'x',price:1}),{status:403});
 assert.throws(()=>createPlan(db,admin,{code:'basic',name:'중복',price:1}),{status:409,code:'CODE_EXISTS'});
 assert.throws(()=>createPlan(db,admin,{code:'Bad Code',name:'x',price:1}),{name:'ZodError'});
 const pro=createPlan(db,admin,{code:'pro',name:'프로',price:19900,monthlyTokens:2000,status:'hidden',position:2});
 assert.deepEqual(listPublicPlans(db).map(p=>p.code),['basic']);
 assert.equal(updatePlan(db,admin,pro.id,{status:'active',version:1}).version,2);
 assert.deepEqual(listPublicPlans(db).map(p=>p.code),['basic','pro']);
 assert.throws(()=>updatePlan(db,admin,pro.id,{name:'x',version:1}),{status:409,code:'VERSION_CONFLICT'});
 createBlog(db,a,{naverId:'a_blog',title:'A',category:'',isPrimary:true});
 startTrial(db,a,{planCode:'basic'},NOW);
 assert.throws(()=>deletePlan(db,admin,plan.id,{version:1}),{status:409,code:'PLAN_IN_USE'});
 deletePlan(db,admin,pro.id,{version:2});
 assert.equal(listAdminPlans(db,admin).length,1);
 assert.ok(audits(db,'admin.plan.create')>=2&&audits(db,'admin.plan.delete')===1);
});

test('token coupons: once per member, limits, period, status, codes are case-insensitive',async t=>{
 const {db,admin,a,b}=await fixture(t);
 const c=createCoupon(db,admin,coupon({maxRedemptions:1}));
 assert.equal(c.code,'WELCOME10');
 assert.throws(()=>createCoupon(db,admin,coupon()),{status:409,code:'CODE_EXISTS'});
 assert.throws(()=>createCoupon(db,admin,coupon({code:'pct',kind:'percent_off',value:120})),{name:'ZodError'});
 assert.throws(()=>redeemCoupon(db,a,{code:'nope-code'},NOW),{status:404,code:'COUPON_NOT_FOUND'});
 assert.equal(redeemCoupon(db,a,{code:' welcome10 '},NOW).tokens,10);
 assert.equal(balance(db,a),10);
 assert.throws(()=>redeemCoupon(db,a,{code:'WELCOME10'},NOW),{status:409,code:'COUPON_ALREADY_USED'});
 assert.throws(()=>redeemCoupon(db,b,{code:'WELCOME10'},NOW),{status:409,code:'COUPON_EXHAUSTED'});
 createCoupon(db,admin,coupon({code:'LATER1',startsAt:new Date(NOW+DAY).toISOString()}));
 assert.throws(()=>redeemCoupon(db,b,{code:'LATER1'},NOW),{status:409,code:'COUPON_NOT_ACTIVE'});
 const off=createCoupon(db,admin,coupon({code:'OFF20',kind:'percent_off',value:20}));
 assert.throws(()=>redeemCoupon(db,b,{code:'OFF20'},NOW),{status:400,code:'COUPON_CHECKOUT_ONLY'});
 updateCoupon(db,admin,off.id,{status:'disabled',version:1});
 assert.equal(listAdminCoupons(db,admin,{}).data.find(x=>x.code==='WELCOME10')?.redemptions,1);
 assert.equal((db.prepare("SELECT count(*) AS n FROM credit_ledger WHERE reason='coupon'").get() as {n:number}).n,1);
});

test('7-day trial: needs a blog, grants pro-rated tokens once per member, email and blog',async t=>{
 const {db,a,b,mk}=await fixture(t);
 assert.throws(()=>startTrial(db,a,{planCode:'basic'},NOW),{status:400,code:'BLOG_REQUIRED'});
 createBlog(db,a,{naverId:'a_blog',title:'A',category:'',isPrimary:true});
 const sub=startTrial(db,a,{planCode:'basic'},NOW);
 assert.equal(sub.status,'trialing');
 assert.equal(sub.currentPeriodEnd-sub.currentPeriodStart,7*DAY);
 assert.equal(balance(db,a),175,'750 tokens × 7/30 days');
 assert.throws(()=>startTrial(db,a,{planCode:'basic'},NOW),{status:409,code:'ALREADY_SUBSCRIBED'});
 createBlog(db,b,{naverId:'a_blog',title:'같은 블로그',category:'',isPrimary:true});
 assert.throws(()=>startTrial(db,b,{planCode:'basic'},NOW),{status:409,code:'TRIAL_ALREADY_USED'},'same blog under another account');
 db.prepare('DELETE FROM users WHERE id=?').run(a);
 const again=await mk('a@example.test','다시가입');
 createBlog(db,again,{naverId:'new_blog',title:'새 블로그',category:'',isPrimary:true});
 assert.throws(()=>startTrial(db,again,{planCode:'basic'},NOW),{status:409,code:'TRIAL_ALREADY_USED'},'same email after re-registering');
});

test('cancel/resume and period rollover expire only the unused period tokens, once',async t=>{
 const {db,a}=await fixture(t);
 createBlog(db,a,{naverId:'a_blog',title:'A',category:'',isPrimary:true});
 const sub=startTrial(db,a,{planCode:'basic'},NOW);
 const canceled=cancelSubscription(db,a,{version:sub.version},NOW+DAY);
 assert.equal(canceled.cancelAtPeriodEnd,true);
 assert.equal(resumeSubscription(db,a,{version:canceled.version},NOW+DAY).cancelAtPeriodEnd,false);
 cancelSubscription(db,a,{version:canceled.version+1},NOW+DAY);
 record(db,{ownerId:a,delta:-100,reason:'generation',refType:'test',refId:'spent'},NOW+2*DAY);
 record(db,{ownerId:a,delta:40,reason:'grant',refType:'test',refId:'bonus'},NOW+2*DAY);
 assert.equal(balance(db,a),115);
 assert.equal(rolloverSubscriptions(db,NOW+7*DAY-1).ended,0,'still inside the period');
 assert.equal(rolloverSubscriptions(db,NOW+7*DAY).ended,1);
 assert.equal(balance(db,a),40,'75 unused trial tokens expire; the separate bonus stays');
 assert.equal(rolloverSubscriptions(db,NOW+8*DAY).ended,0,'idempotent');
 assert.equal(balance(db,a),40);
 assert.equal(currentSubscription(db,a,NOW+8*DAY),null);
 assert.equal((db.prepare('SELECT status FROM subscriptions WHERE id=?').get(sub.id) as {status:string}).status,'canceled');
});

test('admin coupons: 101 tied records are reachable, mutable on page two, and recover after filtering',async t=>{
 const {loadValidPage}=await import('../../src/components/admin/pagination');
 const {db,admin,a}=await fixture(t);
 for(let i=0;i<101;i++)createCoupon(db,admin,coupon({code:`PAGE${String(i).padStart(3,'0')}`}));
 db.prepare('UPDATE coupons SET created_at=?').run(NOW);
 const query={pageSize:100,status:'active'};
 const first=listAdminCoupons(db,admin,{...query,page:1}),last=listAdminCoupons(db,admin,{...query,page:2});
 assert.equal(first.pagination.total,101);assert.equal(last.data.length,1);
 assert.equal(new Set([...first.data,...last.data].map(c=>c.id)).size,101);
 const c=last.data[0];updateCoupon(db,admin,c.id,{status:'disabled',version:c.version});
 const recovered=await loadValidPage(async page=>listAdminCoupons(db,admin,{...query,page}),2);
 assert.equal(recovered.pagination.page,1);assert.equal(recovered.pagination.total,100);
 assert.equal(listAdminCoupons(db,admin,{q:c.code,status:'disabled'}).data[0].id,c.id);
 assert.throws(()=>updateCoupon(db,admin,c.id,{status:'active',version:c.version}),{status:409});
 assert.throws(()=>listAdminCoupons(db,a,{page:2}),{status:403});
});
