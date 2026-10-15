/** Production Next HTTP verification using an isolated database; no external writes. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createPlan} from '../../src/server/billing/plans';
import {createCoupon} from '../../src/server/billing/coupons';
import {requestRefund} from '../../src/server/billing/refunds';

async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-billing-pagination-')),dbPath=join(temp,'db.sqlite');let child:ChildProcess|undefined;
 const password=randomBytes(32).toString('base64url');let result;
 try{
  const db=openDatabase(dbPath);try{const {user}=await register(db,{email:'admin@example.test',password,nickname:'관리자',termsAccepted:true});db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
   const seedNow=Date.now(),plan=createPlan(db,user.id,{code:'pages',name:'페이지 검증',price:9900,monthlyTokens:10});
   const insert=db.prepare("INSERT INTO payments(id,user_id,order_id,order_name,plan_id,list_amount,amount,provider,status,approved_at,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,9900,9900,'toss','paid',?,?,?,?)");
   for(let i=0;i<101;i++){
    const id=`page-payment-${String(i).padStart(3,'0')}`;
    createCoupon(db,user.id,{code:`PAGE${String(i).padStart(3,'0')}`,kind:'tokens',value:10,startsAt:new Date(seedNow-86400000).toISOString(),endsAt:new Date(seedNow+86400000).toISOString()});
    insert.run(id,user.id,`page-order-${String(i).padStart(3,'0')}`,'페이지 검증',plan.id,seedNow,seedNow+86400000,seedNow,seedNow);
    requestRefund(db,user.id,id,{reason:'페이지 검증 환불'},seedNow);
   }
   db.prepare('UPDATE coupons SET created_at=?').run(seedNow);
  }finally{db.close();}
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
  const origin=`http://127.0.0.1:${port}`;
  const req=(path:string,method='GET',data?:unknown,cookie?:string)=>fetch(origin+path,{method,headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads')},stdio:'ignore'});
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('Next exited before readiness');try{if((await req('/api/health')).ok){ready=true;break;}}catch{/* server startup */}await delay(100);}assert.ok(ready);
  const login=await req('/api/auth/login','POST',{email:'admin@example.test',password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const get=async(path:string)=>{const r=await req(path,'GET',undefined,cookie);assert.equal(r.status,200);return r.json();};
  for(const resource of ['coupons','payments','refunds']){
   const first=await get(`/api/admin/${resource}?page=1&pageSize=100`),last=await get(`/api/admin/${resource}?page=2&pageSize=100`);
   assert.equal(first.pagination.total,101);assert.equal(last.data.length,1);
   assert.equal(new Set([...first.data,...last.data].map((r:{id:string})=>r.id)).size,101);
  }
  const coupon=(await get('/api/admin/coupons?page=2&pageSize=100')).data[0];
  const edit=await req(`/api/admin/coupons/${coupon.id}`,'PATCH',{status:'disabled',version:coupon.version},cookie);assert.equal(edit.status,200);
  assert.equal((await get(`/api/admin/coupons?q=${coupon.code}&status=disabled`)).data[0].id,coupon.id);
  const stale=await req(`/api/admin/coupons/${coupon.id}`,'PATCH',{status:'active',version:coupon.version},cookie);assert.equal(stale.status,409);
  const refund=(await get('/api/admin/refunds?page=2&pageSize=100')).data[0];
  const decision=await req(`/api/admin/refunds/${refund.id}/decide`,'POST',{decision:'rejected',note:'검증 거절',version:refund.version},cookie);assert.equal(decision.status,200);
  assert.equal((await get('/api/admin/refunds?status=requested')).pagination.total,100);
  assert.equal((await get('/api/admin/refunds?status=rejected')).data[0].id,refund.id);
  assert.equal((await get('/api/admin/payments?q=page-order-100&status=paid')).data[0].id,'page-payment-100');
  for(const [path,labels] of [['/admin/billing',['쿠폰 페이지']],['/admin/payments',['환불 요청 페이지','결제 내역 페이지']]] as const){
   const response=await req(path,'GET',undefined,cookie);assert.equal(response.status,200);const html=await response.text();for(const label of labels)assert.ok(html.includes(`aria-label="${label}"`));
  }
  const unauthorized=await req('/api/admin/payments?page=2');assert.equal(unauthorized.status,401);
  result={verifiedAt:new Date().toISOString(),checks:['101 coupons/payments/refunds with tied timestamps','API second pages contain distinct records','Page-two coupon update and stale version rejection','Page-two refund rejection changes filtered count without provider call','Payment search reaches record 101','SSR has three separately labeled pagination controls','Unauthenticated admin list denied'],browserVerified:false,externalProviderCalled:false,temporaryDataRemoved:true};
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const processToStop=child,exited=new Promise<void>(r=>processToStop.once('exit',()=>r()));processToStop.kill('SIGTERM');const timer=setTimeout(()=>processToStop.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  rmSync(temp,{recursive:true,force:true});
 }
 writeFileSync(resolve(process.argv[2]||'docs/fullstack/evidence/billing-pagination-runtime.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
