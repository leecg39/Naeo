import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {migrations} from '../../src/server/migrations';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {checkIn,points,tutorial,finishTutorial,saveSubTopic,removeSubTopic,visitRanking} from '../../src/server/engagement/service';

async function fixture(t:TestContext,filename=':memory:'){
 const db=openDatabase(filename);t.after(()=>db.close());
 const member=await register(db,{email:'points@example.test',password:'engagement-test-password',nickname:'포인트',termsAccepted:true});
 return{db,id:member.user.id};
}
const start=Date.parse('2026-10-14T15:00:00Z');
test('schema 26 upgrades to points tables without changing existing accounts, blogs or credit balances',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'naeo-upgrade-points-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'db.sqlite'),old=new DatabaseSync(path);
 old.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL) STRICT;');
 for(const m of migrations.filter(m=>m.version<=26)){
  old.exec(m.sql);old.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(m.version,m.name,createHash('sha256').update(m.sql).digest('hex'),start);
 }
 const {user}=await register(old,{email:'upgrade@example.test',password:'engagement-test-password',nickname:'기존 회원',termsAccepted:true});
 const blog=createBlog(old,user.id,{naverId:'upgrade_blog',title:'기존 블로그'});
 old.prepare("INSERT INTO credit_ledger(id,owner_id,delta,reason,created_at) VALUES(?,?,?,'grant',?)").run('old-credit',user.id,77,start);
 old.close();const upgraded=openDatabase(path);t.after(()=>upgraded.close());
 assert.equal(upgraded.prepare('SELECT max(version) n FROM schema_migrations').get()?.n,migrations.at(-1)!.version);
 assert.equal(upgraded.prepare('SELECT title FROM blogs WHERE id=?').get(blog.id)?.title,'기존 블로그');
 assert.equal(upgraded.prepare('SELECT sum(delta) n FROM credit_ledger WHERE owner_id=?').get(user.id)?.n,77);
 assert.equal(points(upgraded,user.id).balance,0);
 assert.equal(checkIn(upgraded,user.id,start).awarded,5);
});
test('attendance is one atomic grant per member/KST day, resets streak after gaps',async t=>{
 const {db,id}=await fixture(t);
 assert.equal(checkIn(db,id,start).awarded,5);
 assert.equal(checkIn(db,id,start+86_399_999).alreadyCheckedIn,true);
 assert.equal(points(db,id,{},start).balance,5);
 for(let day=1;day<7;day++)checkIn(db,id,start+day*86_400_000);
 assert.equal(points(db,id,{},start+6*86_400_000).balance,50);
 assert.equal(checkIn(db,id,start+8*86_400_000).streak,1);
 assert.equal(points(db,id,{},start+10*86_400_000).attendance.streak,0);
 assert.equal((db.prepare('SELECT count(*) n FROM credit_ledger').get() as {n:number}).n,0);
});
test('source conditions cannot be supplied by callers; claims survive deleted source without duplication',async t=>{
 const {db,id}=await fixture(t);
 assert.throws(()=>finishTutorial(db,id,{step:'blog'}),/등록/);
 assert.throws(()=>finishTutorial(db,id,{step:'blog',hasBlog:true,points:300}));
 const b=createBlog(db,id,{naverId:'points_blog',title:'내 블로그'});
 assert.equal(finishTutorial(db,id,{step:'blog'}).awarded,30);
 db.prepare('DELETE FROM blogs WHERE id=?').run(b.id);
 assert.equal(finishTutorial(db,id,{step:'blog'}).awarded,0);
 assert.equal(points(db,id).balance,30);
 for(const step of ['mate','ai_picks','ranking','verify'])assert.throws(()=>finishTutorial(db,id,{step}));
 assert.equal(tutorial(db,id).completedAll,false);
});
test('mate requires an owned analysis with posts, ranking requires a visit and stored sub-topic',async t=>{
 const {db,id}=await fixture(t),b=createBlog(db,id,{naverId:'points_blog',title:'내 블로그'});
 db.prepare('INSERT INTO mate_reports(token,owner_id,naver_id,score,report_json,post_count,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').run('a'.repeat(22),id,b.naverId,50,'{}',0,start,start+30*86_400_000);
 assert.throws(()=>finishTutorial(db,id,{step:'mate'}),/진단/);
 db.prepare('UPDATE mate_reports SET post_count=1 WHERE token=?').run('a'.repeat(22));
 assert.equal(finishTutorial(db,id,{step:'mate'}).awarded,30);
 saveSubTopic(db,id,{subTopic:'여행',version:0},start);
 assert.throws(()=>finishTutorial(db,id,{step:'ranking'}),/랭킹/);
 visitRanking(db,id,start);
 assert.equal(finishTutorial(db,id,{step:'ranking'},start).awarded,90);
 assert.equal(finishTutorial(db,id,{step:'ranking'},start).awarded,0);
 assert.equal(tutorial(db,id,start).steps.find(s=>s.key==='ranking')!.done,true);
});
test('sub-topic update/delete enforce version and cooldown; clearing cannot bypass it',async t=>{
 const {db,id}=await fixture(t);
 assert.throws(()=>saveSubTopic(db,id,{subTopic:'여행',version:0},start),/블로그/);
 createBlog(db,id,{naverId:'points_blog',title:'블로그'});
 const first=saveSubTopic(db,id,{subTopic:'여행',version:0},start);
 assert.throws(()=>saveSubTopic(db,id,{subTopic:'음식',version:0},start+7*86_400_000),/변경/);
 assert.throws(()=>removeSubTopic(db,id,{version:first.version},start+1),/7일/);
 const removed=removeSubTopic(db,id,{version:first.version},start+7*86_400_000);
 assert.equal(removed.subTopic,'');
 assert.throws(()=>saveSubTopic(db,id,{subTopic:'음식',version:removed.version},start+7*86_400_000+1),/7일/);
 assert.equal(saveSubTopic(db,id,{subTopic:'음식',version:removed.version},start+14*86_400_000).subTopic,'음식');
});
test('mate claims exclude someone else’s reports, unrelated blogs, empty and expired reports',async t=>{
 const {db,id}=await fixture(t),other=await register(db,{email:'mate-other@example.test',password:'engagement-test-password',nickname:'다른 회원',termsAccepted:true});
 createBlog(db,id,{naverId:'my_blog',title:'내 블로그'});
 const insert=db.prepare('INSERT INTO mate_reports(token,owner_id,naver_id,score,report_json,post_count,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)');
 insert.run('a'.repeat(22),other.user.id,'my_blog',50,'{}',10,start,start+30*86_400_000);
 insert.run('b'.repeat(22),id,'unrelated_blog',50,'{}',10,start,start+30*86_400_000);
 insert.run('c'.repeat(22),id,'my_blog',50,'{}',10,start-1,start);
 assert.throws(()=>finishTutorial(db,id,{step:'mate'},start),/진단/);
 assert.equal(points(db,id).balance,0);
});
test('award transaction rolls back if ledger insert fails and ledger edits are refused',async t=>{
 const {db,id}=await fixture(t);
 db.exec("CREATE TRIGGER fail_award BEFORE INSERT ON point_ledger BEGIN SELECT RAISE(ABORT,'forced failure'); END;");
 assert.throws(()=>checkIn(db,id,start),/forced failure/);
 assert.equal((db.prepare('SELECT count(*) n FROM attendance').get() as {n:number}).n,0);
 db.exec('DROP TRIGGER fail_award');checkIn(db,id,start);
 assert.throws(()=>db.prepare('UPDATE point_ledger SET delta=999 WHERE owner_id=?').run(id));
 assert.throws(()=>db.prepare('DELETE FROM point_ledger WHERE owner_id=?').run(id));
 db.prepare('DELETE FROM users WHERE id=?').run(id);
 assert.equal((db.prepare('SELECT count(*) n FROM point_ledger').get() as {n:number}).n,0);
});
test('independent connections and reopening preserve idempotency and member isolation',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'naeo-points-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'db.sqlite'),{db,id}=await fixture(t,path),other=openDatabase(path);t.after(()=>other.close());
 const b=await register(db,{email:'other@example.test',password:'engagement-test-password',nickname:'다른 회원',termsAccepted:true});
 checkIn(db,id,start);assert.equal(checkIn(other,id,start).awarded,0);
 assert.equal(points(other,id,{},start).balance,5);assert.equal(points(other,b.user.id).balance,0);
 const reopened=openDatabase(path);assert.equal(points(reopened,id).balance,5);reopened.close();
 db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(id);
 assert.throws(()=>checkIn(other,id,start+86_400_000),/로그인/);
});
