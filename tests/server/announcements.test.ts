import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {activeAnnouncement,activeAnnouncements} from '../../src/server/content/announcements';
import {listAdminAnnouncements,createAnnouncement,updateAnnouncement,deleteAnnouncement} from '../../src/server/content/admin-announcements';

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const admin=(await register(db,{email:'admin@example.test',password:'admin-long-password',nickname:'관리자',termsAccepted:true})).user;
 const member=(await register(db,{email:'member@example.test',password:'member-long-password',nickname:'회원',termsAccepted:true})).user;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
 return{db,admin:admin.id,member:member.id};
}
const iso=(ms:number)=>new Date(ms).toISOString();
const HOUR=3600_000;
const notice=(over:Record<string,unknown>={})=>({title:'점검 안내',body:'10월 20일 새벽 2시~4시 점검합니다.',linkUrl:'/updates',linkLabel:'자세히',target:'landing',status:'published',...over});
const audits=(db:Database,action:string)=>(db.prepare('SELECT count(*) AS n FROM audit_logs WHERE action=?').get(action) as {n:number}).n;

test('ticker display stores without an image, keeps tokens and supports target/path updates',async t=>{
 const {db,admin}=await fixture(t);
 const a=createAnnouncement(db,admin,notice({type:'event',body:'매주 [coffee] 선물 [airpods] [ipad]',linkLabel:'',metadata:{display:'ticker',exactPath:'/'}}));
 assert.equal(a.metadata.display,'ticker');assert.equal(a.metadata.image,undefined);
 assert.equal(activeAnnouncement(db,'/')?.body,'매주 [coffee] 선물 [airpods] [ipad]');
 assert.equal(activeAnnouncement(db,'/pricing'),null);
 const edited=updateAnnouncement(db,admin,a.id,{version:1,target:'dashboard',metadata:{display:'ticker',exactPath:'/dashboard'},body:'새 이벤트'});
 assert.equal(edited.version,2);assert.equal(activeAnnouncement(db,'/'),null);
 assert.equal(activeAnnouncement(db,'/dashboard')?.body,'새 이벤트');
 deleteAnnouncement(db,admin,a.id,{version:2});assert.equal(activeAnnouncement(db,'/dashboard'),null);
});

test('landing and dashboard queues isolate audiences and retain all eligible notices in deterministic order',async t=>{
 const {db,admin}=await fixture(t),now=Date.now();
 const landing=createAnnouncement(db,admin,notice());
 const dashboard=createAnnouncement(db,admin,notice({title:'회원 공지',target:'dashboard'}));
 const second=createAnnouncement(db,admin,notice({title:'회원 배너',target:'dashboard',metadata:{image:'/banner.png',exactPath:'/dashboard/write'}}));
 db.prepare('UPDATE announcements SET updated_at=? WHERE id=?').run(now+1000,second.id);
 assert.deepEqual(activeAnnouncements(db,'/pricing').map(x=>x.id),[landing.id]);
 assert.deepEqual(activeAnnouncements(db,'/dashboard').map(x=>x.id),[dashboard.id]);
 assert.deepEqual(activeAnnouncements(db,'/dashboard/write').map(x=>x.id),[second.id,dashboard.id]);
 assert.deepEqual(activeAnnouncements(db,'/dashboard/settings').map(x=>x.id),[dashboard.id]);
 for(const path of ['/admin','/login','/auth/terms','/payment/complete','/api/test'])assert.deepEqual(activeAnnouncements(db,path),[]);
 const updated=updateAnnouncement(db,admin,dashboard.id,{target:'landing',version:1});
 assert.equal(updated.target,'landing');assert.deepEqual(activeAnnouncements(db,'/dashboard'),[]);
 assert.equal(activeAnnouncements(db,'/pricing').length,2);
});

test('schema 33 and 34 upgrades preserve existing announcements and banner metadata',async t=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {mkdtempSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {createHash}=await import('node:crypto');
 const {migrations}=await import('../../src/server/migrations');
 const dir=mkdtempSync(join(tmpdir(),'naeo-banner-migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 for(const version of [33,34]){
 const path=join(dir,`old-${version}.sqlite`),old=new DatabaseSync(path);
 try{
  old.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL) STRICT;');
  for(const m of migrations.filter(x=>x.version<=version)){old.exec(m.sql);old.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(m.version,m.name,createHash('sha256').update(m.sql).digest('hex'),Date.now());}
  old.prepare("INSERT INTO announcements(id,title,status,created_at,updated_at) VALUES('legacy','기존 공지','published',1,1)").run();
  if(version===34)old.prepare("UPDATE announcements SET metadata=?,version=7").run(JSON.stringify({image:'/legacy.png'}));
 }finally{old.close();}
 const upgraded=openDatabase(path);try{
  const notice=activeAnnouncement(upgraded,'/');assert.equal(notice?.id,'legacy');assert.deepEqual(notice?.metadata,version===34?{image:'/legacy.png'}:{});if(version===34)assert.equal(notice?.version,7);
  assert.throws(()=>upgraded.prepare("UPDATE announcements SET metadata='[]'").run());
 }finally{upgraded.close();}
 const reopened=openDatabase(path);reopened.close();
 }
});

test('banner metadata persists through CRUD and exactPath filters before selecting a notice',async t=>{
 const {db,admin}=await fixture(t);
 const base=createAnnouncement(db,admin,notice({target:'all'}));
 const metadata={display:'banner',image:'/banner.png',imageMobile:'https://example.test/mobile.png',ratio:'16 / 9',ratioMobile:'4 / 5',exactPath:'/event',ctaLabel:'행사 보기'};
 const a=createAnnouncement(db,admin,notice({target:'all',metadata,linkUrl:'/event',linkLabel:''}));
 db.prepare('UPDATE announcements SET updated_at=updated_at+1000 WHERE id=?').run(a.id);
 assert.deepEqual(a.metadata,metadata);
 assert.equal(activeAnnouncement(db,'/pricing')?.id,base.id,'ineligible latest notice must not mask eligible older one');
 assert.deepEqual(activeAnnouncement(db,'/event')?.metadata,metadata);
 assert.deepEqual(listAdminAnnouncements(db,admin,{}).data.find(x=>x.id===a.id)?.metadata,metadata);
 assert.throws(()=>updateAnnouncement(db,admin,a.id,{metadata:{display:'notice'},version:1}),{name:'ZodError'},'switching to text requires a link label');
 const updated=updateAnnouncement(db,admin,a.id,{metadata:{image:'/new.png'},version:1});
 assert.deepEqual(updated.metadata,{image:'/new.png'},'metadata PATCH replaces the whole object so optional fields can be removed');
 assert.equal(updated.version,2);
 assert.throws(()=>updateAnnouncement(db,admin,a.id,{metadata:{},version:1}),{status:409});
 deleteAnnouncement(db,admin,a.id,{version:2});
 assert.equal(activeAnnouncement(db,'/event')?.id,base.id);
});

test('banner input rejects unsafe URLs, invalid aspect ratios and malformed metadata',async t=>{
 const {db,admin}=await fixture(t);
 for(const metadata of [{display:'banner'}, {image:'javascript:alert(1)'},{image:'//evil.test/x'}, {image:'/\\evil.test/x'}, {image:'data:image/svg+xml,x'}, {ratio:'0 / 5'}, {ratio:'4 / 0'}, {ratio:'calc(1+1)'}, {ratio:'1 / Infinity'}, {exactPath:'//evil.test'}, {exactPath:'/event?x=1'}, {unknown:1}, null]){
  assert.throws(()=>createAnnouncement(db,admin,notice({metadata})),{name:'ZodError'},JSON.stringify(metadata));
 }
 assert.deepEqual(createAnnouncement(db,admin,notice()).metadata,{});
});

test('only admins manage announcements',async t=>{
 const {db,member}=await fixture(t);
 assert.throws(()=>listAdminAnnouncements(db,member,{}),{status:403});
 assert.throws(()=>createAnnouncement(db,member,notice()),{status:403});
});

test('active announcement respects status, period and target',async t=>{
 const {db,admin}=await fixture(t);
 const now=Date.now();
 assert.equal(activeAnnouncement(db,'/',now),null,'no announcement: landing stays identical to the capture');
 const draft=createAnnouncement(db,admin,notice({status:'draft'}));
 assert.equal(activeAnnouncement(db,'/',now),null,'drafts hidden');
 updateAnnouncement(db,admin,draft.id,{status:'published',startsAt:iso(now+HOUR),version:1});
 assert.equal(activeAnnouncement(db,'/',now),null,'not started yet');
 assert.equal(activeAnnouncement(db,'/',now+2*HOUR)?.id,draft.id,'shown after start');
 const ended=createAnnouncement(db,admin,notice({title:'끝난 공지',endsAt:iso(now-HOUR)}));
 assert.notEqual(activeAnnouncement(db,'/',now+2*HOUR)?.id,ended.id,'ended hidden');
 assert.equal(activeAnnouncement(db,'/pricing',now+2*HOUR)?.id,draft.id,'landing target includes public pages');
 const all=createAnnouncement(db,admin,notice({title:'전체 공지',target:'all'}));
 assert.equal(activeAnnouncement(db,'/pricing',now)?.id,all.id);
 assert.equal(activeAnnouncement(db,'/dashboard',now),null,'never on dashboard');
 assert.equal(activeAnnouncement(db,'/admin/users',now),null,'never on admin');
 assert.equal(activeAnnouncement(db,'/',now)?.id,all.id,'most recently updated active one wins');
});

test('announcement CRUD with versions, validation and audit',async t=>{
 const {db,admin}=await fixture(t);
 const a=createAnnouncement(db,admin,notice());
 const edited=updateAnnouncement(db,admin,a.id,{title:'점검 시간 변경',version:1});
 assert.equal(edited.version,2);
 assert.throws(()=>updateAnnouncement(db,admin,a.id,{title:'x',version:1}),{status:409,code:'VERSION_CONFLICT'});
 assert.equal(listAdminAnnouncements(db,admin,{q:'변경'}).pagination.total,1);
 for(const bad of [notice({title:''}),notice({body:'x'.repeat(301)}),notice({linkUrl:'javascript:alert(1)'}),notice({linkUrl:'//evil.example'}),notice({linkUrl:'http://insecure.example'}),notice({target:'everyone'}),notice({extra:1}),notice({startsAt:iso(Date.now()),endsAt:iso(Date.now()-HOUR)}),notice({linkUrl:'/x',linkLabel:''})])
  assert.throws(()=>createAnnouncement(db,admin,bad),{name:'ZodError'});
 assert.equal(createAnnouncement(db,admin,notice({linkUrl:'',linkLabel:''})).linkUrl,'');
 assert.equal(createAnnouncement(db,admin,notice({linkUrl:'https://www.naeo.kr/updates'})).linkUrl,'https://www.naeo.kr/updates');
 deleteAnnouncement(db,admin,a.id,{version:2});
 assert.equal(listAdminAnnouncements(db,admin,{q:'변경'}).pagination.total,0);
 for(const x of ['content.announcement.create','content.announcement.update','content.announcement.delete'])assert.ok(audits(db,x)>=1,x);
});
