import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingMessage} from 'node:http';
import type {AddressInfo} from 'node:net';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';

const origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
const SECRET='test_sk_dummy_for_local_stub';
type Seen={method:string;path:string;auth:string;idem:string};
/** 토스 코어 API 모양을 흉내 내는 로컬 스텁(Basic 인증·멱등 키 확인). 실제 결제사에는 연결하지 않는다. */
async function tossStub(t:TestContext){
 const payments=new Map<string,Record<string,unknown>>(),byIdem=new Map<string,string>(),seen:Seen[]=[];
 const read=(req:IncomingMessage)=>new Promise<Record<string,unknown>>(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(b?JSON.parse(b):{}));});
 const server=createServer(async(req,res)=>{
  const send=(status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  const auth=req.headers.authorization??'',idem=String(req.headers['idempotency-key']??'');
  seen.push({method:req.method!,path:req.url!,auth,idem});
  if(auth!=='Basic '+Buffer.from(`${SECRET}:`).toString('base64'))return send(401,{code:'UNAUTHORIZED_KEY',message:'인증되지 않은 시크릿 키'});
  if(idem&&byIdem.has(idem))return send(200,payments.get(byIdem.get(idem)!));
  const body=req.method==='POST'?await read(req):{};
  if(req.url==='/v1/payments/confirm'){
   const p={paymentKey:body.paymentKey,orderId:body.orderId,status:'DONE',totalAmount:body.amount,balanceAmount:body.amount,method:'카드',approvedAt:'2026-10-14T12:00:00+09:00'};
   payments.set(String(body.paymentKey),p);byIdem.set(idem,String(body.paymentKey));return send(200,p);
  }
  const cancel=req.url!.match(/^\/v1\/payments\/([^/]+)\/cancel$/);
  if(cancel){const p=payments.get(decodeURIComponent(cancel[1]))!;const balance=Number(p.balanceAmount)-Number(body.cancelAmount);const next={...p,balanceAmount:balance,status:balance===0?'CANCELED':'PARTIAL_CANCELED'};payments.set(String(p.paymentKey),next);byIdem.set(idem,String(p.paymentKey));return send(200,next);}
  const get=req.url!.match(/^\/v1\/payments\/([^/]+)$/);
  if(get&&payments.has(decodeURIComponent(get[1])))return send(200,payments.get(decodeURIComponent(get[1])));
  send(404,{code:'NOT_FOUND_PAYMENT',message:'존재하지 않는 결제'});
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 return{base:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,seen};
}
function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const handler=createApi(()=>db);
 const send=(p:string,method='GET',body?:unknown,cookie?:string,withOrigin=true)=>handler(new Request(origin+p,{method,headers:{...(withOrigin?{Origin:origin}:{}),'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}));
 const member=async(email:string)=>{const r=await send('/api/auth/register','POST',{email,password:'billing-http-pass',nickname:email[0],termsAccepted:true});return{cookie:r.headers.get('set-cookie')!.split(';')[0],id:(await r.json()).data.user.id as string};};
 return{db,send,member};
}
function withEnv(t:TestContext,vars:Record<string,string>){
 const before=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));
 Object.assign(process.env,vars);
 t.after(()=>{for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
}

test('billing API without payment keys: plans are public, paid checkout is refused as not configured',async t=>{
 const f=fixture(t);
 const admin=await f.member('admin@example.test');f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
 assert.equal((await f.send('/api/admin/plans','POST',{code:'basic',name:'베이직',price:9900,monthlyTokens:750,trialDays:7},admin.cookie)).status,201);
 const plans=await (await f.send('/api/billing/plans')).json();
 assert.deepEqual(plans.data.map((p:{code:string})=>p.code),['free','basic'],'captured free plan is seeded; the admin-made basic plan is kept');assert.equal(plans.paymentsConfigured,false);
 const m=await f.member('m@example.test');
 assert.equal((await f.send('/api/billing/checkout','POST',{planCode:'basic'},m.cookie)).status,503);
 assert.equal((await f.send('/api/billing/checkout','POST',{planCode:'basic'},m.cookie,false)).status,403,'member routes still need the site origin');
 assert.equal((await f.send('/api/billing/webhooks/toss','POST',{eventType:'PAYMENT_STATUS_CHANGED',createdAt:'x',data:{paymentKey:'k'}},undefined,false)).status,503,'webhook: provider not configured → retried later');
 assert.equal((await f.send('/api/admin/plans','GET',undefined,m.cookie)).status,403);
});

test('billing API end to end against a local Toss stub: trial, coupon, confirm, webhook, refund',async t=>{
 const stub=await tossStub(t);
 withEnv(t,{NAEO_TOSS_CLIENT_KEY:'test_ck_dummy_for_local_stub',NAEO_TOSS_SECRET_KEY:SECRET,NAEO_TOSS_API_BASE:stub.base});
 const f=fixture(t);
 const admin=await f.member('admin@example.test');f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
 await f.send('/api/admin/plans','POST',{code:'basic',name:'베이직',price:9900,monthlyTokens:750,trialDays:7},admin.cookie);
 const window={startsAt:new Date(Date.now()-86_400_000).toISOString(),endsAt:new Date(Date.now()+86_400_000).toISOString()};
 await f.send('/api/admin/coupons','POST',{code:'TOKENS5',kind:'tokens',value:5,...window},admin.cookie);
 await f.send('/api/admin/coupons','POST',{code:'HALF',kind:'percent_off',value:50,...window},admin.cookie);
 const m=await f.member('m@example.test');
 assert.equal((await f.send('/api/billing/trial','POST',{planCode:'basic'},m.cookie)).status,400,'blog required');
 await f.send('/api/blogs','POST',{naverId:'m_blog',title:'M',isPrimary:true},m.cookie);
 assert.equal((await f.send('/api/billing/trial','POST',{planCode:'basic'},m.cookie)).status,201);
 assert.equal((await (await f.send('/api/billing/coupons/redeem','POST',{code:'tokens5'},m.cookie)).json()).data.tokens,5);
 const order=(await (await f.send('/api/billing/checkout','POST',{planCode:'basic',couponCode:'HALF'},m.cookie)).json()).data;
 assert.deepEqual([order.amount,order.clientKey],[4950,'test_ck_dummy_for_local_stub']);
 const confirmed=await f.send('/api/billing/confirm','POST',{paymentKey:'tpk_1',orderId:order.orderId,amount:4950},m.cookie);
 assert.equal(confirmed.status,200);
 const call=stub.seen.find(s=>s.path==='/v1/payments/confirm')!;
 assert.equal(call.idem,`confirm-${order.orderId}`);
 assert.equal((await (await f.send(`/api/billing/payments/${order.orderId}`,'GET',undefined,m.cookie)).json()).data.status,'paid');
 const hook={eventType:'PAYMENT_STATUS_CHANGED',createdAt:'2026-10-14T12:00:01.000',data:{paymentKey:'tpk_1',orderId:order.orderId,status:'DONE'}};
 assert.equal((await (await f.send('/api/billing/webhooks/toss','POST',hook,undefined,false)).json()).data.result,'noop','already paid via the success page');
 assert.equal((await (await f.send('/api/billing/webhooks/toss','POST',hook,undefined,false)).json()).data.result,'duplicate');
 const me=(await (await f.send('/api/billing/me','GET',undefined,m.cookie)).json()).data;
 assert.equal(me.subscription.status,'active');assert.equal(me.paymentsConfigured,true);
 const paymentId=me.payments[0].id;
 const refund=(await (await f.send(`/api/billing/payments/${paymentId}/refund`,'POST',{reason:'테스트 환불'},m.cookie)).json()).data;
 assert.equal((await f.send(`/api/admin/refunds/${refund.id}/decide`,'POST',{decision:'approved',version:1},m.cookie)).status,403);
 const decided=await f.send(`/api/admin/refunds/${refund.id}/decide`,'POST',{decision:'approved',version:1},admin.cookie);
 assert.equal((await decided.json()).data.status,'completed');
 assert.equal(stub.seen.find(s=>s.path.endsWith('/cancel'))!.idem,`refund-${refund.id}`);
 assert.equal((await (await f.send('/api/billing/me','GET',undefined,m.cookie)).json()).data.subscription,null,'refunded period ends');
 assert.ok(stub.seen.every(s=>s.auth==='Basic '+Buffer.from(`${SECRET}:`).toString('base64')),'every call uses Basic secret-key auth');
});
