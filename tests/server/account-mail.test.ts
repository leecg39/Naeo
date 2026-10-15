import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {requestPersonalExport,runPersonalExportOnce,downloadPersonalExport} from '../../src/server/privacy/personal-export';
import {decryptMail} from '../../src/server/mail/provider';
import {randomBytes} from 'node:crypto';
import {openDatabase} from '../../src/server/database';
import {register,login,tokenHash,createSession} from '../../src/server/auth';
import {changePassword} from '../../src/server/account-security';
import {createApi} from '../../src/server/api';
import {requestReset,requestVerification,resetPassword,verifyEmail,mailStatus} from '../../src/server/mail/account-mail';
import {runMailOnce,cleanupMail} from '../../src/server/mail/worker';
import type {MailConfig,MailMessage} from '../../src/server/mail/provider';
import {MailError} from '../../src/server/mail/provider';
const password='synthetic-account-mail-password',origin='http://127.0.0.1:3000';
const config:MailConfig={apiKey:'synthetic-only',from:'sender@example.test',key:Buffer.alloc(32,3),apiBase:origin,appOrigin:origin};
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const a=await register(db,{email:'mail-owner@example.test',password,nickname:'인증 검증',termsAccepted:true});
 const sent:{message:MailMessage;id:string}[]=[];
 const send=async(message:MailMessage,id:string)=>{sent.push({message,id});return 'provider-'+id;};
 const run=()=>runMailOnce(db,config,send);
 return {db,a,sent,send,run};
}
const tokenOf=(m:MailMessage)=>new URL(m.text.match(/http[^\s]+/)![0]).hash.slice('#token='.length);
test('reset request is generic; worker sends opaque fragment token and DB stores no raw token/payload',async t=>{
 const {db,a,sent,run}=await fixture(t);
 assert.deepEqual(requestReset(db,{email:a.user.email},config),requestReset(db,{email:'absent@example.test'},config));
 assert.equal((db.prepare('SELECT count(*) AS n FROM account_mail').get()!).n,1);await run();assert.equal(sent.length,1);
 const token=tokenOf(sent[0].message);assert.match(token,/^[A-Za-z0-9_-]{43}$/);
 const row=db.prepare('SELECT * FROM account_mail').get()!;assert.equal(row.token_hash,tokenHash(token));assert.equal(row.state,'accepted');assert.equal(row.encrypted_payload,null);
 const dump=JSON.stringify(db.prepare('SELECT * FROM account_mail').all());assert.ok(!dump.includes(token));assert.ok(!dump.includes('새 비밀번호'));
 const result=await resetPassword(db,{token,newPassword:'replacement-test-password'});assert.deepEqual(result,{changed:true});
 assert.equal(db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(a.user.id)!.n,0);
 await assert.rejects(()=>login(db,{email:a.user.email,password}),{status:401});await login(db,{email:a.user.email,password:'replacement-test-password'});
 await assert.rejects(()=>resetPassword(db,{token,newPassword:'yet-another-password'}),{code:'INVALID_EMAIL_LINK'});
});
test('verification is bound to the account and purpose; GET does not consume; reset token cannot verify',async t=>{
 const {db,a,sent,run}=await fixture(t);requestVerification(db,a.user.id,config);await run();const verify=tokenOf(sent[0].message);
 await assert.rejects(()=>resetPassword(db,{token:verify,newPassword:'replacement-test-password'}),{code:'INVALID_EMAIL_LINK'});
 process.env.NAEO_APP_URL=origin;const api=createApi(()=>db);assert.notEqual((await api(new Request(origin+'/api/auth/email/verify?token='+verify))).status,200);
 assert.equal(verifyEmail(db,{token:verify}).verified,true);assert.ok(mailStatus(db,a.user.id,config).verified);
 assert.throws(()=>verifyEmail(db,{token:verify}),{code:'INVALID_EMAIL_LINK'});
 requestReset(db,{email:a.user.email},config);await run();assert.throws(()=>verifyEmail(db,{token:tokenOf(sent[1].message)}),{code:'INVALID_EMAIL_LINK'});
});
test('expired links fail, successful reset invalidates all links and concurrent use has one winner',async t=>{
 const {db,a,sent,run}=await fixture(t);requestReset(db,{email:a.user.email},config);await run();const expired=tokenOf(sent[0].message);
 db.prepare('UPDATE account_mail SET expires_at=0').run();await assert.rejects(()=>resetPassword(db,{token:expired,newPassword:'replacement-test-password'}),{code:'INVALID_EMAIL_LINK'});
 cleanupMail(db);requestReset(db,{email:a.user.email},config);await run();const token=tokenOf(sent[1].message);
 const outcomes=await Promise.allSettled([resetPassword(db,{token,newPassword:'first-new-password'}),resetPassword(db,{token,newPassword:'second-new-password'})]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.prepare('SELECT count(*) AS n FROM account_mail').get()!.n,0);
});
test('password change/email change/suspension/deletion invalidate outstanding mail and pending delivery',async t=>{
 const {db,a,sent,run}=await fixture(t);requestReset(db,{email:a.user.email},config);await run();const token=tokenOf(sent[0].message);
 await changePassword(db,a.user.id,{currentPassword:password,newPassword:'changed-long-password'});
 await assert.rejects(()=>resetPassword(db,{token,newPassword:'replacement-test-password'}),{code:'INVALID_EMAIL_LINK'});
 requestVerification(db,a.user.id,config);db.prepare('UPDATE users SET email=? WHERE id=?').run('changed@example.test',a.user.id);assert.equal(await run(),false);
 requestReset(db,{email:'changed@example.test'},config);db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(a.user.id);assert.equal(await run(),false);
 db.prepare("UPDATE users SET status='active' WHERE id=?").run(a.user.id);requestReset(db,{email:'changed@example.test'},config);db.prepare('DELETE FROM users WHERE id=?').run(a.user.id);assert.equal(await run(),false);
});
test('transient send failure retries identical payload and idempotency key; permanent failure is visible to owner',async t=>{
 const {db,a,sent,send}=await fixture(t);requestVerification(db,a.user.id,config);let first:MailMessage|undefined,key='';
 await runMailOnce(db,config,async(m,k)=>{first=m;key=k;throw new MailError('RATE_LIMITED',true,1000);});
 assert.equal(mailStatus(db,a.user.id,config).latest?.state,'retry');db.prepare('UPDATE account_mail SET run_after=0').run();
 await runMailOnce(db,config,send);assert.deepEqual(sent[0].message,first);assert.equal(sent[0].id,key);
 db.prepare('DELETE FROM account_mail').run();requestVerification(db,a.user.id,config);
 await runMailOnce(db,config,async()=>{throw new MailError('PROVIDER_REJECTED',false);});assert.equal(mailStatus(db,a.user.id,config).latest?.state,'failed');
 assert.equal(db.prepare('SELECT encrypted_payload FROM account_mail').get()!.encrypted_payload,null);
});
test('missing configuration never reports sent, wrong encryption key fails without outbound request',async t=>{
 const {db,a}=await fixture(t);assert.throws(()=>requestReset(db,{email:a.user.email},null),{code:'MAIL_NOT_CONFIGURED'});
 assert.equal(mailStatus(db,a.user.id,null).available,false);requestReset(db,{email:a.user.email},config);
 let calls=0;await runMailOnce(db,{...config,key:randomBytes(32)},async()=>{calls++;return 'bad';});assert.equal(calls,0);assert.equal(db.prepare('SELECT state FROM account_mail').get()!.state,'failed');
});
test('recovered lease uses the same delivery; late prior worker cannot overwrite cancellation',async t=>{
 const {db,a,run,sent}=await fixture(t);requestVerification(db,a.user.id,config);
 db.prepare("UPDATE account_mail SET state='sending',lease_until=0,attempt=1").run();await run();assert.equal(sent.length,1);
 db.prepare('DELETE FROM account_mail').run();requestVerification(db,a.user.id,config);
 await runMailOnce(db,config,async()=>{db.prepare('DELETE FROM users WHERE id=?').run(a.user.id);return 'accepted-after-deletion';});assert.equal(db.prepare('SELECT count(*) AS n FROM account_mail').get()!.n,0);
});
test('reset revokes all sessions and personal export requests',async t=>{
 const {db,a,sent,run}=await fixture(t);createSession(db,a.user.id);
 db.prepare("INSERT INTO personal_exports(id,owner_id,session_hash,created_at,expires_at) VALUES('pending',?,?,?,?)").run(a.user.id,tokenHash(a.session.token),Date.now(),Date.now()+50000);
 requestReset(db,{email:a.user.email},config);await run();await resetPassword(db,{token:tokenOf(sent[0].message),newPassword:'new-password-reset-test'});
 assert.equal(db.prepare('SELECT count(*) AS n FROM personal_exports').get()!.n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get()!.n,0);
});
test('HTTP origin and generic recovery responses; verification status never exposes token or ciphertext',async t=>{
 const {db,a}=await fixture(t),previous={...process.env};
 Object.assign(process.env,{NAEO_APP_URL:origin,NAEO_EMAIL_PROVIDER:'resend',NAEO_RESEND_API_KEY:config.apiKey,NAEO_MAIL_FROM:config.from,NAEO_MAIL_ENCRYPTION_KEY:config.key.toString('hex')});
 t.after(()=>{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);});
 const handler=createApi(()=>db),send=(path:string,data:unknown,cookie?:string,from=origin)=>handler(new Request(origin+path,{method:'POST',headers:{Origin:from,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)}));
 assert.equal((await send('/api/auth/password/forgot',{email:a.user.email},undefined,'https://bad.test')).status,403);
 const known=await send('/api/auth/password/forgot',{email:a.user.email}),unknown=await send('/api/auth/password/forgot',{email:'unknown@example.test'});assert.equal(known.status,202);assert.equal(unknown.status,202);assert.deepEqual((await known.json()).data,(await unknown.json()).data);
 assert.equal((await send('/api/auth/email/request',{})).status,401);assert.equal((await send('/api/auth/email/request',{},`naeo_session=${a.session.token}`)).status,202);
 const r=await handler(new Request(origin+'/api/auth/email/status',{headers:{Cookie:`naeo_session=${a.session.token}`}}));assert.equal(r.status,200);
 const text=await r.text();for(const field of ['token_hash','encrypted_payload','provider_id',a.session.token])assert.ok(!text.includes(field));
 for(let i=0;i<4;i++)await send('/api/auth/password/forgot',{email:'unknown@example.test'});
 assert.equal((await send('/api/auth/password/forgot',{email:'unknown@example.test'})).status,429);
});
test('resends retain earlier link until success and successful reset revokes refresh/access tokens',async t=>{
 const {db,a,sent,run}=await fixture(t),now=Date.now();
 db.prepare("INSERT INTO oauth_clients(client_id,name,kind,redirect_uris_json,created_at) VALUES('mail-client','Mail QA','mcp','[]',?)").run(now);
 for(const kind of ['access','refresh'])db.prepare("INSERT INTO oauth_tokens(token_hash,kind,client_id,user_id,scope,resource,family_id,expires_at,created_at) VALUES(?,?,'mail-client',?,'mcp','https://example.test/mcp','family',?,?)").run(tokenHash(kind),kind,a.user.id,now+60000,now);
 requestReset(db,{email:a.user.email},config,now-61000);await run();requestReset(db,{email:a.user.email},config,now);await run();assert.equal(sent.length,2);
 await resetPassword(db,{token:tokenOf(sent[0].message),newPassword:'renewed-safe-password'});
 await assert.rejects(()=>resetPassword(db,{token:tokenOf(sent[1].message),newPassword:'another-safe-password'}),{code:'INVALID_EMAIL_LINK'});
 assert.equal(db.prepare('SELECT count(*) AS n FROM oauth_tokens WHERE revoked_at IS NOT NULL').get()!.n,2);
});
test('expired/retry-exhausted mail never sends, repeated request within a minute uses one outbox item',async t=>{
 const {db,a,sent,run}=await fixture(t);requestReset(db,{email:a.user.email},config);requestReset(db,{email:a.user.email},config);assert.equal(db.prepare('SELECT count(*) AS n FROM account_mail').get()!.n,1);
 db.prepare("UPDATE account_mail SET state='sending',attempt=5,lease_until=0").run();assert.equal(await run(),false);assert.equal(db.prepare('SELECT state FROM account_mail').get()!.state,'failed');assert.equal(sent.length,0);
 db.prepare('UPDATE account_mail SET expires_at=0').run();assert.equal(cleanupMail(db),1);
});
test('queued links are not sent to an obsolete application origin after configuration changes',async t=>{
 const {db,a}=await fixture(t);requestReset(db,{email:a.user.email},config);let sent=0;
 await runMailOnce(db,{...config,appOrigin:'https://new.example.test'},async()=>{sent++;return 'wrong-host';});
 assert.equal(sent,0);assert.equal(db.prepare('SELECT error_code FROM account_mail').get()!.error_code,'MAIL_CONFIG_CHANGED');
});
test('personal archive includes safe delivery metadata but never authentication token or encrypted message',async t=>{
 const {db,a}=await fixture(t),dir=mkdtempSync(join(tmpdir(),'mail-export-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));requestReset(db,{email:a.user.email},config);
 const row=db.prepare('SELECT id,token_hash,encrypted_payload FROM account_mail').get() as {id:string;token_hash:string;encrypted_payload:string};
 const token=tokenOf(decryptMail(row.encrypted_payload,row.id,config.key));
 const job=await requestPersonalExport(db,a.user.id,a.session.token,{currentPassword:password});runPersonalExportOnce(db,dir);
 const archive=Buffer.from(await downloadPersonalExport(db,dir,a.user.id,a.session.token,job.id).arrayBuffer()).toString();assert.ok(archive.includes('data/account_mail.ndjson'));
 for(const secret of [token,row.token_hash,row.encrypted_payload,'encrypted_payload'])assert.ok(!archive.includes(secret));
});
