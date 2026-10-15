// Run after npm run build: node --import tsx scripts/verify-payment-recovery.mjs
// Owns an isolated Next server, temporary SQLite DB and loopback payment stub. No external payment calls.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url),{openDatabase}=require('../src/server/database.ts');
const root=await mkdtemp(join(tmpdir(),'naeo-payment-recovery-')),dbPath=join(root,'db.sqlite');
const origin='http://127.0.0.1:3112',checks=[],snapshots=new Map(),seen=new Map();
let child,mode='normal',cancelArrived,confirmMoves=0,cancelMoves=0;
const key='local-payment',password=randomBytes(24).toString('base64url');
const stub=createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=raw?JSON.parse(raw):{},idem=String(req.headers['idempotency-key']||'');
  const send=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  assert.match(String(req.headers.authorization),/^Basic /);
  if(seen.has(idem))return send(seen.get(idem));
  if(req.url==='/v1/payments/confirm'){
   assert.ok(idem.startsWith('confirm-'));confirmMoves++;
   const p={paymentKey:body.paymentKey,orderId:body.orderId,totalAmount:body.amount,balanceAmount:body.amount,status:'DONE',method:'카드',approvedAt:new Date().toISOString()};
   snapshots.set(body.paymentKey,p);seen.set(idem,p);
   if(mode==='confirm-drop'){req.socket.destroy();return;}return send(p);
  }
  if(req.url===`/v1/payments/${key}/cancel`){
   assert.ok(idem.startsWith('refund-'));cancelMoves++;
   const p=snapshots.get(key),next={...p,status:'CANCELED',balanceAmount:p.balanceAmount-body.cancelAmount};
   snapshots.set(key,next);seen.set(idem,next);
   if(mode==='cancel-hold'){cancelArrived();return;}return send(next);
  }
  if(req.url===`/v1/payments/${key}`){const p=snapshots.get(key);return send(mode==='wrong-identity'?{...p,paymentKey:'wrong'}:p);}
  res.writeHead(404);res.end('{}');
 }catch{res.writeHead(500);res.end('{}');}
});
await new Promise(resolve=>stub.listen(0,'127.0.0.1',resolve));
async function start(){
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3112'],{env:{...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(root,'uploads'),NAEO_TOSS_CLIENT_KEY:'test_ck_local_stub',NAEO_TOSS_SECRET_KEY:'test_sk_local_stub',NAEO_TOSS_API_BASE:`http://127.0.0.1:${stub.address().port}`},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('QA server startup timed out')),15000);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`QA server exited ${code}`));});child.stdout.on('data',chunk=>{if(chunk.toString().includes('Ready')){clearTimeout(timer);resolve();}});child.stderr.resume();});
}
async function stop(signal='SIGTERM'){if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill(signal);await done;}}
async function call(cookie,path,method='GET',body){
 const r=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 return{status:r.status,payload:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
function check(label,actual,expected){assert.deepEqual(actual,expected,label);checks.push({label,result:'passed'});}
async function member(email){const r=await call(null,'/api/auth/register','POST',{email,password,nickname:'결제 검증',termsAccepted:true});check('register',r.status,201);return{cookie:r.cookie,id:r.payload.data.user.id};}
try{
 await start();const admin=await member('admin@example.test'),memberA=await member('member@example.test'),other=await member('other@example.test');
 const db=openDatabase(dbPath);db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);db.close();
 check('create plan',(await call(admin.cookie,'/api/admin/plans','POST',{code:'recover',name:'복구 검증',price:9900,monthlyTokens:750})).status,201);
 const order=(await call(memberA.cookie,'/api/billing/checkout','POST',{planCode:'recover'})).payload.data;
 mode='confirm-drop';check('lost confirmation response',(await call(memberA.cookie,'/api/billing/confirm','POST',{paymentKey:key,orderId:order.orderId,amount:9900})).status,503);
 check('uncertain order cannot be replaced',(await call(memberA.cookie,'/api/billing/checkout','POST',{planCode:'recover'})).status,409);
 let account=(await call(memberA.cookie,'/api/billing/me')).payload.data;
 check('pending visible',account.payments[0].status,'ready');
 const html=await(await fetch(origin+'/dashboard/settings',{headers:{Cookie:memberA.cookie}})).text();
 check('SSR pending recovery control',html.includes('같은 결제 승인 재시도'),true);
 check('owner isolation',(await call(other.cookie,`/api/billing/payments/${order.orderId}/reconcile`,'POST')).status,404);
 mode='wrong-identity';check('wrong provider identity',(await call(memberA.cookie,`/api/billing/payments/${order.orderId}/reconcile`,'POST')).status,502);
 mode='normal';check('reconcile approved payment',(await call(memberA.cookie,`/api/billing/payments/${order.orderId}/reconcile`,'POST')).payload.data.status,'paid');
 account=(await call(memberA.cookie,'/api/billing/me')).payload.data;
 check('paid after lost response',account.payments[0].status,'paid');
 const refund=(await call(memberA.cookie,`/api/billing/payments/${account.payments[0].id}/refund`,'POST',{reason:'중단 복구 검증'})).payload.data;
 let arrived;const providerSawCancel=new Promise(resolve=>{arrived=resolve;});cancelArrived=arrived;mode='cancel-hold';
 const pending=call(admin.cookie,`/api/admin/refunds/${refund.id}/decide`,'POST',{decision:'approved',version:refund.version}).catch(()=>null);
 await providerSawCancel;await stop('SIGKILL');await pending;
 mode='normal';await start();
 const interrupted=(await call(admin.cookie,'/api/admin/refunds')).payload.data.find(r=>r.id===refund.id);
 check('crashed refund persisted',interrupted.status,'approved');
 check('grace prevents competing retry',(await call(admin.cookie,`/api/admin/refunds/${refund.id}/decide`,'POST',{decision:'approved',version:interrupted.version})).payload.error.code,'REFUND_PROCESSING');
 const remaining=Math.max(0,interrupted.decidedAt+61_000-Date.now());
 console.log(JSON.stringify({phase:'waiting_for_real_refund_grace',remainingMs:remaining}));
 await new Promise(resolve=>setTimeout(resolve,remaining));
 const recovered=await call(admin.cookie,`/api/admin/refunds/${refund.id}/decide`,'POST',{decision:'approved',version:interrupted.version});
 check('crashed refund recovered',recovered.payload.data.status,'completed');
 account=(await call(memberA.cookie,'/api/billing/me')).payload.data;
 check('payment canceled',account.payments[0].status,'canceled');check('subscription ended',account.subscription,null);
 const inspect=openDatabase(dbPath);check('tokens reclaimed',inspect.prepare('SELECT coalesce(sum(delta),0) n FROM credit_ledger WHERE owner_id=?').get(memberA.id).n,0);inspect.close();
 check('provider confirms once',confirmMoves,1);check('provider cancels once',cancelMoves,1);
 await mkdir('docs/fullstack/evidence',{recursive:true});
 await writeFile('docs/fullstack/evidence/payment-recovery-http.json',JSON.stringify({at:new Date().toISOString(),checks,provider:'loopback stub',realProviderVerified:false,crashSignal:'SIGKILL',databaseReopened:true,credentialsSaved:false,limitations:['No actual Toss sandbox credentials or browser hydration were used.']},null,2)+'\n');
 console.log(JSON.stringify({status:'passed',checks:checks.length,confirmMoves,cancelMoves}));
}finally{await stop();stub.closeAllConnections();await new Promise(resolve=>stub.close(resolve));await rm(root,{recursive:true,force:true});}
