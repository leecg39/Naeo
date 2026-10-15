import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register,userById} from '../../src/server/auth';
import {createInquiry} from '../../src/server/inquiries/inquiries';
import {addReply,getAdminInquiry,updateReply,deleteReply} from '../../src/server/inquiries/admin-inquiries';
import {queueReplyMail,runInquiryMailOnce} from '../../src/server/inquiries/mail';
import {MailError,type MailConfig} from '../../src/server/mail/provider';
const config:MailConfig={apiKey:'local-test',from:'support@example.test',key:Buffer.alloc(32,7),apiBase:'http://127.0.0.1:9999',appOrigin:'http://localhost:3000'};
async function setup(t:TestContext){const db=openDatabase(':memory:');t.after(()=>db.close());const u=(await register(db,{email:'admin@example.test',password:'long-enough-password',nickname:'관리자',termsAccepted:true})).user;db.prepare("UPDATE users SET role='admin' WHERE id=?").run(u.id);const admin=userById(db,u.id);const q=createInquiry(db,null,{type:'etc',email:'guest@example.test',message:'문의합니다'});const detail=addReply(db,admin.id,q.id,{body:'답변'.repeat(5000),version:q.version});return{db,admin,id:q.id,reply:detail.replies[0].id,version:detail.version};}
test('explicit admin send encrypts full reply, guest recipient, immutable and idempotent queue',async t=>{
 const {db,admin,id,reply,version}=await setup(t);assert.throws(()=>queueReplyMail(db,admin.id,id,reply,{version},null),{status:503});queueReplyMail(db,admin.id,id,reply,{version},config);
 assert.equal(getAdminInquiry(db,admin.id,id).replies[0].mailState,'queued');
 assert.throws(()=>queueReplyMail(db,admin.id,id,reply,{version},config),{code:'VERSION_CONFLICT'});
 queueReplyMail(db,admin.id,id,reply,{version:version+1},config);assert.equal((db.prepare('SELECT count(*) n FROM inquiry_mail').get() as {n:number}).n,1);
 assert.throws(()=>updateReply(db,admin.id,id,reply,{body:'changed',version:version+1}),{code:'REPLY_DISPATCHED'});
 let calls=0;await runInquiryMailOnce(db,config,async m=>{calls++;assert.equal(m.to[0],'guest@example.test');assert.ok(m.text.includes('답변'.repeat(5000)));return 'local';});assert.equal(calls,1);
 assert.equal(getAdminInquiry(db,admin.id,id).replies[0].mailState,'accepted');assert.equal((db.prepare('SELECT payload FROM inquiry_mail').get() as {payload:null}).payload,null);assert.equal(await runInquiryMailOnce(db,config),false);
});
test('transient failure retries same immutable content/key; deletion fences late completion',async t=>{
 const {db,admin,id,reply,version}=await setup(t);queueReplyMail(db,admin.id,id,reply,{version},config);let old='',body='';
 await runInquiryMailOnce(db,config,async(m,key)=>{old=key;body=JSON.stringify(m);throw new MailError('LOCAL_FAILURE',true);});assert.equal(getAdminInquiry(db,admin.id,id).replies[0].mailState,'retry');db.prepare('UPDATE inquiry_mail SET run_after=0').run();
 await runInquiryMailOnce(db,config,async(m,key)=>{assert.equal(key,old);assert.equal(JSON.stringify(m),body);deleteReply(db,admin.id,id,reply,{version:version+1});return 'late';});assert.equal((db.prepare('SELECT count(*) n FROM inquiry_mail').get() as {n:number}).n,0);
});
test('corrupt key fails without outbound request or plaintext exposure',async t=>{
 const {db,admin,id,reply,version}=await setup(t);queueReplyMail(db,admin.id,id,reply,{version},config);let sent=false;
 await runInquiryMailOnce(db,{...config,key:Buffer.alloc(32,8)},async()=>{sent=true;return 'no';});assert.equal(sent,false);assert.equal(getAdminInquiry(db,admin.id,id).replies[0].mailState,'failed');assert.equal((db.prepare('SELECT payload FROM inquiry_mail').get() as {payload:null}).payload,null);
});
test('expired replies never send; permanent provider failures remove ciphertext',async t=>{
 const {db,admin,id,reply,version}=await setup(t);queueReplyMail(db,admin.id,id,reply,{version},config);db.prepare('UPDATE inquiry_mail SET expires_at=0').run();assert.equal(await runInquiryMailOnce(db,config,async()=>{throw Error('must not send');}),false);assert.equal(getAdminInquiry(db,admin.id,id).replies[0].mailState,'failed');
 const q=addReply(db,admin.id,id,{body:'another',version:version+1});const rid=q.replies.find(r=>r.body==='another')!.id;queueReplyMail(db,admin.id,id,rid,{version:q.version},config);
 await runInquiryMailOnce(db,config,async()=>{throw new MailError('PROVIDER_REJECTED',false);});assert.equal((db.prepare('SELECT payload FROM inquiry_mail WHERE reply_id=?').get(rid) as {payload:null}).payload,null);
});
test('reply queue delivers through actual HTTP adapter and disallows non-admin dispatch',async t=>{
 const {createServer}=await import('node:http');const {db,admin,id,reply,version}=await setup(t);let received='';
 const server=createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer local-test');assert.ok(req.headers['idempotency-key']);req.on('data',b=>{received+=b;});req.on('end',()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'local-http'}));});});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());const address=server.address();assert.ok(address&&typeof address==='object');
 db.prepare("UPDATE users SET role='member' WHERE id=?").run(admin.id);assert.throws(()=>queueReplyMail(db,admin.id,id,reply,{version},config),{status:403});db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
 const local={...config,apiBase:`http://127.0.0.1:${address.port}`};queueReplyMail(db,admin.id,id,reply,{version},local);await runInquiryMailOnce(db,local);assert.equal(JSON.parse(received).to[0],'guest@example.test');assert.equal(getAdminInquiry(db,admin.id,id).replies[0].mailState,'accepted');
});
