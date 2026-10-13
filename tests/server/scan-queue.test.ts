import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {enqueueScan,getScan,listScans,cancelScan,retryScan,claimNextScan,reportProgress,completeScan,failScan,isCancelRequested,LEASE_MS} from '../../src/server/jobs/queue';
import {runWorkerOnce} from '../../src/server/jobs/worker';

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const make=async(email:string)=>(await register(db,{email,password:'queue-long-password',nickname:'큐',termsAccepted:true})).user;
 const owner=await make('owner@example.test'),other=await make('other@example.test');
 const blog=createBlog(db,owner.id,{naverId:'queue_blog',title:'큐 블로그',category:'',isPrimary:true});
 return{db,owner:owner.id,other:other.id,blog:blog.id};
}
const count=(db:Database,state:string)=>(db.prepare('SELECT count(*) AS n FROM scan_jobs WHERE state=?').get(state) as {n:number}).n;

test('enqueue is owner-scoped, idempotent and allows one active scan per blog',async t=>{
 const {db,owner,other,blog}=await fixture(t);
 assert.throws(()=>enqueueScan(db,other,{blogId:blog}),{status:404},'cannot scan someone else\'s blog');
 const a=enqueueScan(db,owner,{blogId:blog,idempotencyKey:'k-1'});
 assert.equal(a.state,'queued');assert.equal(a.attempt,0);
 assert.equal(enqueueScan(db,owner,{blogId:blog,idempotencyKey:'k-1'}).id,a.id,'same key returns the same job');
 assert.throws(()=>enqueueScan(db,owner,{blogId:blog,idempotencyKey:'k-2'}),{status:409,code:'SCAN_IN_PROGRESS'});
 assert.equal(listScans(db,owner,{}).pagination.total,1);
 assert.equal(listScans(db,other,{}).pagination.total,0);
 assert.throws(()=>getScan(db,other,a.id),{status:404});
});

test('claim leases one job at a time; a second worker cannot take it until the lease expires',async t=>{
 const {db,owner,blog}=await fixture(t);
 const job=enqueueScan(db,owner,{blogId:blog});
 const now=Date.now();
 const claimed=claimNextScan(db,'w1',now);
 assert.equal(claimed?.id,job.id);assert.equal(claimed?.attempt,1);assert.equal(claimed?.state,'running');
 assert.equal(claimNextScan(db,'w2',now+1000),null,'leased job is not handed out twice');
 reportProgress(db,job.id,'w1',40,now+2000);
 assert.equal(getScan(db,owner,job.id).progress,40);
 assert.throws(()=>reportProgress(db,job.id,'w2',50,now+2000),{code:'LEASE_LOST'},'other workers cannot write');
 // worker w1 crashes: after the lease expires another worker recovers the job
 const recovered=claimNextScan(db,'w2',now+2000+LEASE_MS+1);
 assert.equal(recovered?.id,job.id);assert.equal(recovered?.attempt,2);
 assert.throws(()=>completeScan(db,job.id,'w1',{score:50},now+LEASE_MS*3),{code:'LEASE_LOST'},'stale worker result is rejected');
 completeScan(db,job.id,'w2',{score:77},now+LEASE_MS+5000);
 const done=getScan(db,owner,job.id);
 assert.equal(done.state,'succeeded');assert.equal(done.progress,100);assert.deepEqual(done.result,{score:77});
});

test('failures retry with backoff up to the attempt limit, then fail permanently',async t=>{
 const {db,owner,blog}=await fixture(t);
 const job=enqueueScan(db,owner,{blogId:blog});
 let now=Date.now();
 for(let attempt=1;attempt<=3;attempt++){
  const c=claimNextScan(db,'w',now);
  assert.equal(c?.attempt,attempt);
  failScan(db,job.id,'w',{code:'FETCH_FAILED',message:'네트워크 오류',retryable:true},now);
  const s=getScan(db,owner,job.id);
  if(attempt<3){
   assert.equal(s.state,'queued');assert.ok(s.runAfter>now,'backoff delays the retry');
   assert.equal(claimNextScan(db,'w',now+1),null,'not before backoff');
   now=s.runAfter;
  }else{assert.equal(s.state,'failed');assert.equal(s.errorCode,'FETCH_FAILED');}
 }
 const job2=enqueueScan(db,owner,{blogId:blog});
 claimNextScan(db,'w',now);
 failScan(db,job2.id,'w',{code:'BLOG_NOT_FOUND',message:'없는 블로그',retryable:false},now);
 assert.equal(getScan(db,owner,job2.id).state,'failed','non-retryable errors fail immediately');
});

test('cancel queued and running jobs; retry creates a fresh job',async t=>{
 const {db,owner,other,blog}=await fixture(t);
 const queued=enqueueScan(db,owner,{blogId:blog});
 assert.throws(()=>cancelScan(db,other,queued.id),{status:404});
 assert.equal(cancelScan(db,owner,queued.id).state,'canceled');
 assert.equal(claimNextScan(db,'w',Date.now()),null);
 const running=enqueueScan(db,owner,{blogId:blog});
 claimNextScan(db,'w',Date.now());
 const req=cancelScan(db,owner,running.id);
 assert.equal(req.state,'running');assert.equal(req.cancelRequested,true);
 assert.equal(isCancelRequested(db,running.id),true);
 completeScan(db,running.id,'w',{score:1},Date.now());
 assert.equal(getScan(db,owner,running.id).state,'canceled','a cancel request wins over a late result');
 const again=retryScan(db,owner,running.id,{});
 assert.notEqual(again.id,running.id);assert.equal(again.state,'queued');assert.equal(again.retryOf,running.id);
 assert.throws(()=>retryScan(db,owner,again.id,{}),{status:409,code:'SCAN_NOT_RETRYABLE'},'only finished jobs can be retried');
 assert.throws(()=>retryScan(db,owner,queued.id,{}),{status:409,code:'SCAN_IN_PROGRESS'},'still one active job per blog');
 assert.throws(()=>enqueueScan(db,owner,{blogId:blog,idempotencyKey:'other'}),{status:409,code:'SCAN_IN_PROGRESS'});
});

test('runWorkerOnce runs the handler, reports progress and handles errors and cancellation',async t=>{
 const {db,owner,blog}=await fixture(t);
 const ok=enqueueScan(db,owner,{blogId:blog});
 const ran=await runWorkerOnce(db,'w',async(job,ctx)=>{await ctx.progress(50);return{score:88,blogId:job.blogId};});
 assert.equal(ran,ok.id);
 assert.equal(getScan(db,owner,ok.id).state,'succeeded');
 assert.equal(await runWorkerOnce(db,'w',async()=>({})),null,'idle when nothing is queued');
 const bad=enqueueScan(db,owner,{blogId:blog});
 await runWorkerOnce(db,'w',async()=>{throw Object.assign(new Error('boom'),{code:'FETCH_FAILED',retryable:true});});
 assert.equal(getScan(db,owner,bad.id).state,'queued');
 assert.equal(getScan(db,owner,bad.id).errorCode,'FETCH_FAILED');
 cancelScan(db,owner,bad.id);
 assert.equal(count(db,'canceled'),1);
});
