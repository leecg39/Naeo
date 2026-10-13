import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';
import {claimNextScan} from '../../src/server/jobs/queue';
import {LEASE_MS} from '../../src/server/jobs/timing';
import {runWorkerOnce} from '../../src/server/jobs/worker';

const origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
const password='scan-http-test-password';
function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const handler=createApi(()=>db);
 const send=(p:string,method='GET',body?:unknown,cookie?:string)=>handler(new Request(origin+p,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}));
 return{db,send};
}
async function account(f:ReturnType<typeof fixture>,email:string,admin=false){
 const r=await f.send('/api/auth/register','POST',{email,password,nickname:'진단',termsAccepted:true});
 const id=(await r.json()).data.user.id as string;
 if(admin)f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(id);
 return r.headers.get('set-cookie')!.split(';')[0];
}
async function blogOf(f:ReturnType<typeof fixture>,cookie:string,naverId:string){
 const r=await f.send('/api/blogs','POST',{naverId,title:'블로그',isPrimary:true},cookie);
 return (await r.json()).data.id as string;
}

test('member scan API: create, list, read, cancel, retry with ownership and conflicts',async t=>{
 const f=fixture(t);const a=await account(f,'a@example.test');const b=await account(f,'b@example.test');
 const blog=await blogOf(f,a,'scan_http_blog');
 assert.equal((await f.send('/api/scans','POST',{blogId:blog})).status,401);
 assert.equal((await f.send('/api/scans','POST',{blogId:blog},b)).status,404,'not your blog');
 const created=await f.send('/api/scans','POST',{blogId:blog,idempotencyKey:'once'},a);
 assert.equal(created.status,201);
 const job=(await created.json()).data;
 assert.equal(job.state,'queued');assert.equal('leaseOwner' in job,false,'no worker details for members');
 assert.equal((await (await f.send('/api/scans','POST',{blogId:blog,idempotencyKey:'once'},a)).json()).data.id,job.id);
 const conflict=await f.send('/api/scans','POST',{blogId:blog},a);
 assert.equal(conflict.status,409);assert.equal((await conflict.json()).error.code,'SCAN_IN_PROGRESS');
 assert.equal((await f.send(`/api/scans/${job.id}`,'GET',undefined,b)).status,404);
 assert.equal((await (await f.send(`/api/scans?blogId=${blog}`,'GET',undefined,a)).json()).pagination.total,1);
 assert.equal((await (await f.send(`/api/scans/${job.id}/cancel`,'POST',{},a)).json()).data.state,'canceled');
 assert.equal((await f.send(`/api/scans/${job.id}/cancel`,'POST',{},a)).status,409);
 const retried=await f.send(`/api/scans/${job.id}/retry`,'POST',{},a);
 assert.equal(retried.status,201);assert.equal((await retried.json()).data.retryOf,job.id);
});

test('admin scan health, list, cancel and retry; members are forbidden',async t=>{
 const f=fixture(t);const a=await account(f,'a@example.test');const admin=await account(f,'admin@example.test',true);
 const blog=await blogOf(f,a,'scan_admin_blog');
 const job=(await (await f.send('/api/scans','POST',{blogId:blog},a)).json()).data;
 assert.equal((await f.send('/api/admin/scan-health','GET',undefined,a)).status,403);
 await runWorkerOnce(f.db,'test-worker',async()=>{throw Object.assign(new Error('없는 블로그'),{code:'BLOG_NOT_FOUND',retryable:false});});
 const health=(await (await f.send('/api/admin/scan-health','GET',undefined,admin)).json()).data;
 assert.equal(health.counts.failed,1);assert.equal(health.aliveWorkers,1);
 assert.equal(health.recentFailures[0].errorCode,'BLOG_NOT_FOUND');assert.equal(health.recentFailures[0].naverId,'scan_admin_blog');
 const list=await (await f.send('/api/admin/scans?state=failed','GET',undefined,admin)).json();
 assert.equal(list.data[0].id,job.id);
 const retried=await f.send(`/api/admin/scans/${job.id}/retry`,'POST',{},admin);
 assert.equal(retried.status,201);
 const next=(await retried.json()).data;
 assert.equal((await (await f.send(`/api/admin/scans/${next.id}/cancel`,'POST',{},admin)).json()).data.state,'canceled');
});

test('jobs survive a process restart and a crashed worker\'s job is recovered',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'naeo-scan-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'scan.sqlite');
 let db=openDatabase(file);
 const owner=(db.prepare("INSERT INTO users(id,email,password_hash,role,status,created_at,updated_at,terms_accepted_at) VALUES('u1','r@example.test','x','member','active',1,1,1) RETURNING id").get() as {id:string}).id;
 db.prepare("INSERT INTO blogs(id,owner_id,naver_id,title,created_at,updated_at) VALUES('00000000-0000-4000-8000-000000000001',?,'restart_blog','b',1,1)").run(owner);
 db.prepare("INSERT INTO scan_jobs(id,owner_id,blog_id,state,run_after,created_at,updated_at) VALUES('j1',?,'00000000-0000-4000-8000-000000000001','queued',0,0,0)").run(owner);
 const now=Date.now();
 assert.equal(claimNextScan(db,'crashed-worker',now)?.id,'j1');
 db.close();
 db=openDatabase(file);t.after(()=>db.close());
 assert.equal(claimNextScan(db,'new-worker',now+1000),null,'lease still valid right after restart');
 const recovered=claimNextScan(db,'new-worker',now+LEASE_MS+1);
 assert.equal(recovered?.id,'j1');assert.equal(recovered?.attempt,2);
});

test('scan result history and latest report are owner-only over HTTP',async t=>{
 const f=fixture(t);const a=await account(f,'a@example.test');const b=await account(f,'b@example.test');
 const blog=await blogOf(f,a,'scan_result_blog');
 assert.equal((await (await f.send(`/api/blogs/${blog}/scan-results/latest`,'GET',undefined,a)).json()).data,null,'no report yet');
 const {saveScanResult}=await import('../../src/server/analysis/results');
 const {analyzePosts}=await import('../../src/server/analysis/rules');
 const job=(await (await f.send('/api/scans','POST',{blogId:blog},a)).json()).data;
 const owner=(f.db.prepare('SELECT owner_id FROM scan_jobs WHERE id=?').get(job.id) as {owner_id:string}).owner_id;
 saveScanResult(f.db,{ownerId:owner,blogId:blog,jobId:job.id,report:analyzePosts([]),postCount:0,measuredAt:Date.now()});
 const latest=(await (await f.send(`/api/blogs/${blog}/scan-results/latest`,'GET',undefined,a)).json()).data;
 assert.equal(latest.criteria.length,5);assert.equal(latest.aiCitation.status,'not_configured');
 assert.equal((await (await f.send(`/api/blogs/${blog}/scan-results`,'GET',undefined,a)).json()).pagination.total,1);
 assert.equal((await f.send(`/api/blogs/${blog}/scan-results/latest`,'GET',undefined,b)).status,404);
});
