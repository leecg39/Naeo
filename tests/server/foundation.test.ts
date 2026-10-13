import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,transaction} from '../../src/server/database';
import {register,login,sessionUser,logout,tokenHash,requireAdmin,SESSION_TTL} from '../../src/server/auth';
import {getProfile,updateProfile} from '../../src/server/profiles';
import {createBlog,getBlog,listBlogs,updateBlog,deleteBlog} from '../../src/server/blogs';
import {rateLimit} from '../../src/server/http';

const input={email:'owner@example.test',password:'correct-long-password',nickname:'소유자',termsAccepted:true as const};
function fixture(t:TestContext){const db=openDatabase(':memory:');t.after(()=>db.close());return db;}
test('migrations reapply safely, persist data on reopen and protect database permissions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'naeo-db-')),file=join(dir,'nested','data.sqlite');
 try{
  let db=openDatabase(file);const account=await register(db,input);const blog=createBlog(db,account.user.id,{naverId:'persist_blog',title:'저장된 블로그'});db.close();
  db=openDatabase(file);assert.equal(getBlog(db,account.user.id,blog.id).title,'저장된 블로그');assert.equal(sessionUser(db,account.session.token)?.id,account.user.id);
  assert.equal((db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as {n:number}).n,2);
  assert.equal(statSync(file).mode&0o777,0o600);db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('migration checksum mismatch is rejected without wiping saved data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'naeo-migrate-')),file=join(dir,'db.sqlite');
 try{const db=openDatabase(file);db.prepare("UPDATE schema_migrations SET checksum='changed'").run();db.close();assert.throws(()=>openDatabase(file),/checksum mismatch/);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('transaction failures roll back every write and FK/CHECK constraints are active',async t=>{
 const db=fixture(t),account=await register(db,input);
 assert.throws(()=>transaction(db,()=>{db.prepare("UPDATE profiles SET nickname='rollback' WHERE user_id=?").run(account.user.id);throw Error('rollback');}),/rollback/);
 assert.equal(getProfile(db,account.user.id).nickname,'소유자');
 assert.throws(()=>db.prepare("INSERT INTO profiles(user_id,nickname,updated_at) VALUES('missing','x',0)").run(),/FOREIGN KEY/);
 assert.throws(()=>db.prepare("UPDATE users SET role='root'").run(),/CHECK/);
});
test('registration normalizes email, hashes credentials, never auto-promotes, and blocks duplicates',async t=>{
 const db=fixture(t),a=await register(db,{...input,email:' Owner@Example.Test '});
 assert.equal(a.user.email,'owner@example.test');assert.equal(a.user.role,'member');
 const raw=db.prepare('SELECT password_hash FROM users WHERE id=?').get(a.user.id) as {password_hash:string};
 assert.ok(raw.password_hash.startsWith('scrypt$'));assert.ok(!raw.password_hash.includes(input.password));
 assert.equal(db.prepare('SELECT token_hash FROM sessions').get()?.token_hash,tokenHash(a.session.token));
 await assert.rejects(register(db,input),{code:'EMAIL_EXISTS',status:409});
 assert.throws(()=>requireAdmin(a.user),{status:403});
});
test('login rejects unknown email, bad password, and suspended account',async t=>{
 const db=fixture(t),a=await register(db,input);
 await assert.rejects(login(db,{email:input.email,password:'wrong'}),{status:401,code:'INVALID_CREDENTIALS'});
 await assert.rejects(login(db,{email:'missing@example.test',password:input.password}),{status:401});
 assert.equal((await login(db,{email:input.email,password:input.password})).user.id,a.user.id);
 db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(a.user.id);
 assert.equal(sessionUser(db,a.session.token),null);
 await assert.rejects(login(db,{email:input.email,password:input.password}),{status:401});
});
test('sessions reject tampering, expire, and are revoked by logout',async t=>{
 const db=fixture(t),a=await register(db,input);
 assert.equal(sessionUser(db,a.session.token)?.id,a.user.id);assert.equal(sessionUser(db,'x'.repeat(43)),null);assert.equal(sessionUser(db,'malformed'),null);
 logout(db,a.session.token);assert.equal(sessionUser(db,a.session.token),null);
 const b=await login(db,{email:input.email,password:input.password});
 db.prepare('UPDATE sessions SET created_at=?,expires_at=?').run(Date.now()-SESSION_TTL,Date.now()-1);
 assert.equal(sessionUser(db,b.session.token),null);
});
test('profile update rejects version conflicts and privileged fields',async t=>{
 const db=fixture(t),a=await register(db,input);
 const p=updateProfile(db,a.user.id,{nickname:'새 닉네임',rankingPublic:true,version:1});
 assert.equal(p.version,2);assert.equal(p.rankingPublic,true);
 assert.throws(()=>updateProfile(db,a.user.id,{nickname:'오래된 탭',version:1}),{status:409});
 for(const key of ['role','credits','plan','userId']) assert.throws(()=>updateProfile(db,a.user.id,{version:2,[key]:'admin'}));
 assert.throws(()=>updateProfile(db,a.user.id,{avatarUrl:'javascript:alert(1)',version:2}));
 assert.equal(getProfile(db,a.user.id).nickname,'새 닉네임');
});
test('blog CRUD isolates two users, preserves primary invariant, and checks versions',async t=>{
 const db=fixture(t),a=await register(db,input),b=await register(db,{...input,email:'other@example.test'});
 const first=createBlog(db,a.user.id,{naverId:'first_blog',title:'첫 블로그'});
 assert.equal(first.isPrimary,true);
 for(const action of [()=>getBlog(db,b.user.id,first.id),()=>updateBlog(db,b.user.id,first.id,{title:'침입',version:1}),()=>deleteBlog(db,b.user.id,first.id,{version:1})])assert.throws(action,{status:404});
 assert.equal(listBlogs(db,b.user.id).pagination.total,0);
 const second=createBlog(db,a.user.id,{naverId:'second_blog',title:'둘째',isPrimary:true});
 assert.equal(getBlog(db,a.user.id,first.id).isPrimary,false);assert.equal(getBlog(db,a.user.id,first.id).version,2);
 assert.throws(()=>updateBlog(db,a.user.id,first.id,{title:'old',version:1}),{status:409});
 const updated=updateBlog(db,a.user.id,first.id,{title:'제목 변경',version:2});assert.equal(updated.version,3);
 deleteBlog(db,a.user.id,second.id,{version:1});assert.equal(getBlog(db,a.user.id,first.id).isPrimary,true);
 assert.throws(()=>deleteBlog(db,a.user.id,first.id,{version:3}),{status:409});
 deleteBlog(db,a.user.id,first.id,{version:4});assert.equal(listBlogs(db,a.user.id).pagination.total,0);
});
test('blog duplicate/invalid input and paginated literal searches are handled',async t=>{
 const db=fixture(t),a=await register(db,input);
 createBlog(db,a.user.id,{naverId:'example_blog',title:'100% 좋은 글'});
 createBlog(db,a.user.id,{naverId:'example_blog2',title:'다른 글'});
 assert.throws(()=>createBlog(db,a.user.id,{naverId:'EXAMPLE_BLOG',title:'중복'}),{code:'BLOG_EXISTS'});
 assert.throws(()=>createBlog(db,a.user.id,{naverId:'http://localhost/',title:'invalid'}));
 assert.equal(listBlogs(db,a.user.id,{q:'%'}).pagination.total,1);
 const page=listBlogs(db,a.user.id,{page:2,pageSize:1});assert.equal(page.data.length,1);assert.equal(page.pagination.total,2);
 assert.throws(()=>listBlogs(db,a.user.id,{pageSize:100000}));
});
test('rate limit survives new calls and resets only when the window expires',t=>{
 const db=fixture(t);rateLimit(db,'a',2,1000,100);rateLimit(db,'a',2,1000,101);
 assert.throws(()=>rateLimit(db,'a',2,1000,102),{status:429});rateLimit(db,'a',2,1000,1100);
 assert.equal(db.prepare('SELECT key FROM rate_limits').get()?.key,tokenHash('a'));
});
