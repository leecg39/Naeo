import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,type Database} from '../../src/server/database';
import {migrations} from '../../src/server/migrations';
import {register,login,sessionUser,tokenHash,userById,requireTerms} from '../../src/server/auth';
import {changePassword,deleteAccount,listSessions,revokeSession,revokeOtherSessions,acceptTerms} from '../../src/server/account-security';
import {createUser,updateUser,removeUser,listUsers,managedUser,listAudit} from '../../src/server/admin-users';
import {createBlog} from '../../src/server/blogs';
import {getProfile,updateProfile} from '../../src/server/profiles';
import {saveContact,getContact,deleteContact,getPreferences,savePreferences} from '../../src/server/preferences';
import {safeNext} from '../../src/lib/safe-next';

const password='original-test-password';
function fixture(t:TestContext){const db=openDatabase(':memory:');t.after(()=>db.close());return db;}
async function member(db:Database,email='member@example.test'){return register(db,{email,password,nickname:'회원',termsAccepted:true});}
async function admin(db:Database,email='admin@example.test'){const a=await member(db,email);db.prepare("UPDATE users SET role='admin' WHERE id=?").run(a.user.id);return {...a,user:userById(db,a.user.id)};}
test('v1 migration preserves existing users, sessions and blogs while assigning safe session IDs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'naeo-v1-')),file=join(dir,'db.sqlite');
 try {
  const old=new DatabaseSync(file),v1=migrations[0];
  old.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL) STRICT;');
  old.exec(v1.sql);old.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(1,v1.name,createHash('sha256').update(v1.sql).digest('hex'),Date.now());
  old.prepare('INSERT INTO users(id,email,password_hash,terms_accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('legacy-user','legacy@example.test','legacy-hash',100,100,100);
  old.prepare('INSERT INTO profiles(user_id,nickname,updated_at) VALUES(?,?,?)').run('legacy-user','기존 사용자',100);
  const token='a'.repeat(43);old.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(tokenHash(token),'legacy-user',Date.now()-100,Date.now()+100000);old.close();
  const db=openDatabase(file);assert.equal(sessionUser(db,token)?.version,1);assert.equal(getProfile(db,'legacy-user').nickname,'기존 사용자');
  assert.equal(listSessions(db,'legacy-user',token).length,1);assert.match(listSessions(db,'legacy-user',token)[0].id,/^[a-f0-9]{32}$/);
  assert.equal(getPreferences(db,'legacy-user').marketingEmail,false);db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('admin user CRUD requires current authority and reauthentication and records changes without secrets',async t=>{
 const db=fixture(t),a=await admin(db),m=await member(db);
 assert.throws(()=>listUsers(db,m.user.id,{}),{status:403});
 await assert.rejects(createUser(db,m.user.id,{email:'x@example.test',nickname:'x',password,currentPassword:password}),{status:403});
 await assert.rejects(createUser(db,a.user.id,{email:'x@example.test',nickname:'x',password,currentPassword:'bad'}),{code:'REAUTHENTICATION_FAILED'});
 const created=await createUser(db,a.user.id,{email:'new@example.test',nickname:'새 회원',password,currentPassword:password});
 assert.equal(created.role,'member');assert.equal(created.termsAcceptedAt,0);assert.equal(created.sessionCount,0);
 assert.throws(()=>requireTerms(userById(db,created.id)),{code:'TERMS_REQUIRED'});
 const signed=await login(db,{email:created.email,password});assert.ok(sessionUser(db,signed.session.token));
 acceptTerms(db,created.id,{termsAccepted:true});assert.ok(userById(db,created.id).termsAcceptedAt);
 const after=await updateUser(db,a.user.id,created.id,{nickname:'운영팀 수정',status:'suspended',version:2,currentPassword:password});
 assert.equal(after.nickname,'운영팀 수정');assert.equal(after.version,3);assert.equal(sessionUser(db,signed.session.token),null);
 await assert.rejects(login(db,{email:created.email,password}),{status:401});
 await assert.rejects(updateUser(db,a.user.id,created.id,{status:'active',version:2,currentPassword:password}),{status:409});
 assert.equal(listUsers(db,a.user.id,{q:'운영팀',status:'suspended'}).pagination.total,1);
 assert.equal(managedUser(db,a.user.id,created.id).status,'suspended');
 await assert.rejects(removeUser(db,a.user.id,created.id,{confirmEmail:'wrong@example.test',currentPassword:password,version:3}),{code:'EMAIL_MISMATCH'});
 await removeUser(db,a.user.id,created.id,{confirmEmail:created.email,currentPassword:password,version:3});
 assert.throws(()=>managedUser(db,a.user.id,created.id),{status:404});
 const log=listAudit(db,a.user.id,{});assert.ok(log.data.some(row=>row.action==='admin.user.create'));assert.ok(log.data.some(row=>row.action==='account.delete'));
 assert.ok(!JSON.stringify(log).includes(password));assert.ok(!JSON.stringify(log).includes('password_hash'));
});
test('last active admin cannot be deleted, suspended or demoted, including simultaneous demotions',async t=>{
 const db=fixture(t),a=await admin(db);
 for(const patch of [{role:'member'},{status:'suspended'}])await assert.rejects(updateUser(db,a.user.id,a.user.id,{...patch,version:1,currentPassword:password}),{code:'LAST_ADMIN'});
 await assert.rejects(removeUser(db,a.user.id,a.user.id,{confirmEmail:a.user.email,version:1,currentPassword:password}),{code:'LAST_ADMIN'});
 await assert.rejects(deleteAccount(db,a.user.id,{confirmEmail:a.user.email,version:1,currentPassword:password}),{code:'LAST_ADMIN'});
 const pending=await createUser(db,a.user.id,{email:'pending-admin@example.test',nickname:'동의 대기 관리자',role:'admin',password,currentPassword:password});
 assert.equal(pending.termsAcceptedAt,0);
 await assert.rejects(updateUser(db,a.user.id,a.user.id,{role:'member',version:1,currentPassword:password}),{code:'LAST_ADMIN'});
 await removeUser(db,a.user.id,pending.id,{confirmEmail:pending.email,version:1,currentPassword:password});
 const b=await admin(db,'admin2@example.test');
 const results=await Promise.allSettled([updateUser(db,a.user.id,a.user.id,{role:'member',version:1,currentPassword:password}),updateUser(db,b.user.id,b.user.id,{role:'member',version:1,currentPassword:password})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(db.prepare("SELECT count(*) AS n FROM users WHERE role='admin' AND status='active'").get()?.n,1);
});
test('profile edits conflict with stale admin edits and revoked administrators cannot reuse stale authorization',async t=>{
 const db=fixture(t),a=await admin(db),b=await admin(db,'admin2@example.test'),m=await member(db);
 updateProfile(db,m.user.id,{nickname:'회원의 새 이름',version:1});
 await assert.rejects(updateUser(db,a.user.id,m.user.id,{nickname:'오래된 이름',version:1,currentPassword:password}),{code:'VERSION_CONFLICT'});
 await updateUser(db,b.user.id,a.user.id,{role:'member',version:1,currentPassword:password});
 assert.equal(sessionUser(db,a.session.token),null);
 await assert.rejects(createUser(db,a.user.id,{email:'illegal@example.test',nickname:'illegal',password,currentPassword:password}),{status:403});
});
test('password changes require old password, rotate all sessions, and reject the old password',async t=>{
 const db=fixture(t),a=await member(db),b=await login(db,{email:a.user.email,password});
 await assert.rejects(changePassword(db,a.user.id,{currentPassword:'wrong',newPassword:'new-strong-password'}),{code:'REAUTHENTICATION_FAILED'});
 const fresh=await changePassword(db,a.user.id,{currentPassword:password,newPassword:'new-strong-password'});
 assert.equal(sessionUser(db,a.session.token),null);assert.equal(sessionUser(db,b.session.token),null);assert.equal(sessionUser(db,fresh.token)?.id,a.user.id);
 await assert.rejects(login(db,{email:a.user.email,password}),{status:401});assert.ok(await login(db,{email:a.user.email,password:'new-strong-password'}));
});
test('session lists conceal hashes, isolate owners, revoke others and can revoke current session',async t=>{
 const db=fixture(t),a=await member(db),b=await member(db,'other@example.test'),second=await login(db,{email:a.user.email,password});
 const sessions=listSessions(db,a.user.id,a.session.token);assert.equal(sessions.length,2);assert.equal(sessions.filter(s=>s.current).length,1);
 assert.ok(!JSON.stringify(sessions).includes(tokenHash(a.session.token)));assert.ok(!JSON.stringify(sessions).includes(a.session.token));
 assert.equal(sessionUser(db,sessions[0].id),null);
 assert.throws(()=>revokeSession(db,b.user.id,sessions[0].id,b.session.token),{status:404});
 assert.equal(revokeOtherSessions(db,a.user.id,a.session.token).revoked,1);assert.equal(sessionUser(db,second.session.token),null);assert.ok(sessionUser(db,a.session.token));
 assert.equal(revokeSession(db,a.user.id,sessions.find(s=>s.current)!.id,a.session.token).current,true);assert.equal(sessionUser(db,a.session.token),null);
});
test('account deletion requires matching email/password/version and cascades personal data and sessions',async t=>{
 const db=fixture(t),a=await member(db);createBlog(db,a.user.id,{naverId:'owned_blog',title:'개인 블로그'});
 saveContact(db,a.user.id,{name:'테스트 이름',email:'contact@example.test',phone:'01012345678'},true);
 savePreferences(db,a.user.id,{version:1,marketingEmail:true});
 await assert.rejects(deleteAccount(db,a.user.id,{currentPassword:'wrong',confirmEmail:a.user.email,version:1}),{code:'REAUTHENTICATION_FAILED'});
 await assert.rejects(deleteAccount(db,a.user.id,{currentPassword:password,confirmEmail:'wrong@example.test',version:1}),{code:'EMAIL_MISMATCH'});
 await assert.rejects(deleteAccount(db,a.user.id,{currentPassword:password,confirmEmail:a.user.email,version:2}),{code:'VERSION_CONFLICT'});
 await deleteAccount(db,a.user.id,{currentPassword:password,confirmEmail:a.user.email,version:1});
 for(const table of ['users','profiles','blogs','sessions','contact_details','notification_preferences','consent_history'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,0,table);
 assert.ok(db.prepare("SELECT id FROM audit_logs WHERE action='account.delete' AND actor_id IS NULL").get());assert.equal(sessionUser(db,a.session.token),null);
});
test('contact CRUD cannot forge verification, invalidates verification on phone change, and audits opt-in transitions',async t=>{
 const db=fixture(t),a=await member(db),b=await member(db,'other@example.test');
 const fields={name:'연락 담당',email:'contact@example.test',phone:'01012345678'};
 assert.throws(()=>saveContact(db,a.user.id,{...fields,phoneVerifiedAt:Date.now()},true));
 const contact=saveContact(db,a.user.id,fields,true)!;assert.equal(contact.phoneVerifiedAt,null);assert.equal(getContact(db,b.user.id),null);
 assert.throws(()=>saveContact(db,a.user.id,fields,true),{code:'CONTACT_EXISTS'});
 db.prepare('UPDATE contact_details SET phone_verified_at=100 WHERE user_id=?').run(a.user.id);
 assert.equal(saveContact(db,a.user.id,{...fields,name:'변경 이름',version:1})?.phoneVerifiedAt,100);
 assert.equal(saveContact(db,a.user.id,{...fields,phone:'01099998888',version:2})?.phoneVerifiedAt,null);
 assert.throws(()=>deleteContact(db,a.user.id,{version:2}),{status:409});deleteContact(db,a.user.id,{version:3});assert.equal(getContact(db,a.user.id),null);
 assert.equal(getPreferences(db,a.user.id).marketingEmail,false);
 savePreferences(db,a.user.id,{version:1,marketingEmail:true,scanEmail:true});
 savePreferences(db,a.user.id,{version:2,marketingEmail:false});
 assert.throws(()=>savePreferences(db,a.user.id,{version:1,autoscan:true}),{status:409});
 const history=db.prepare("SELECT accepted FROM consent_history WHERE user_id=? AND kind='marketing_email' ORDER BY created_at,id").all(a.user.id);
 assert.equal(history.length,2);assert.deepEqual(history.map(r=>r.accepted).sort(),[0,1]);
});
test('safe next paths reject external, encoded slashes, backslashes, control characters and auth loops',()=>{
 for(const value of ['https://evil.test','//evil.test','/%2fevil.test','/\\evil.test','/%5cevil.test','/login','/api/test','/auth/terms','/a\n',null,['/dashboard']])assert.equal(safeNext(value),'/dashboard');
 assert.equal(safeNext('/admin/users?q=test'),'/admin/users?q=test');assert.equal(safeNext(undefined,'/dashboard/settings'),'/dashboard/settings');
});
test('account and admin page data can cross the React server/client boundary without SQLite prototypes',async t=>{
 const db=fixture(t),a=await admin(db),m=await member(db);
 saveContact(db,m.user.id,{name:'연락처',email:'contact@example.test',phone:''},true);
 function check(value:unknown):void {
  if(value===null||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach(check);return;}
  assert.equal(Object.getPrototypeOf(value),Object.prototype,'Client props must use plain objects');
  Object.values(value).forEach(check);
 }
 [userById(db,m.user.id),sessionUser(db,m.session.token),getContact(db,m.user.id),getPreferences(db,m.user.id),getProfile(db,m.user.id),listSessions(db,m.user.id,m.session.token),listUsers(db,a.user.id,{}),listAudit(db,a.user.id,{})].forEach(check);
});
