import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {applySeeds} from '../../src/server/content/seed';
import {createEvent,updateEvent} from '../../src/server/events/events';
import {submitEntry,reviewEntry} from '../../src/server/events/entries';
import {buildEventListPage,buildDashboardEventsPage,buildEventDetailPage} from '../../src/server/events/event-pages';
import type {CapturedNode} from '../../src/types/site';

type El=Exclude<CapturedNode,string>;
const all=(nodes:CapturedNode[],f:(n:El)=>boolean,out:El[]=[]):El[]=>{for(const n of nodes){if(typeof n==='string')continue;if(f(n))out.push(n);all(n.children,f,out);}return out;};
const text=(n:CapturedNode):string=>typeof n==='string'?n:n.children.map(text).join('');
const NOW=Date.parse('2026-10-14T03:00:00Z'),DAY=86_400_000;
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());applySeeds(db,NOW);
 const mk=async(email:string)=>(await register(db,{email,password:'event-page-password',nickname:email[0],termsAccepted:true})).user.id;
 const admin=await mk('admin@example.test'),m=await mk('m@example.test');
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);
 return{db,admin,m};
}
const cards=(body:CapturedNode[])=>all(body,n=>n.tag==='a'&&/^\/(dashboard\/)?event[s]?\//.test(n.attrs.href??''));

test('public list comes from the database: seeded events, drafts hidden, covers from cover_image',async t=>{
 const {db,admin}=await fixture(t);
 createEvent(db,admin,{slug:'draft-one',title:'초안 이벤트',startsAt:new Date(NOW-DAY).toISOString(),endsAt:new Date(NOW+DAY).toISOString()});
 createEvent(db,admin,{slug:'xss',title:'<img src=x onerror=alert(1)>',status:'published',startsAt:new Date(NOW-DAY).toISOString(),endsAt:new Date(NOW+DAY).toISOString()});
 const page=await buildEventListPage(db,NOW);
 assert.deepEqual(cards(page.body).map(a=>a.attrs.href).sort(),['/event/naeo-review','/event/ranking-reward','/event/xss']);
 const imgs=all(page.body,n=>n.tag==='main').flatMap(m=>all([m],n=>n.tag==='img'));
 assert.deepEqual(imgs.map(i=>i.attrs.src).sort(),['/assets/2e11be7158d9feb4.png','/assets/fc2151ea8a854a0d.png'],'seeded covers render, uncovered cards have none');
 assert.equal(imgs.find(i=>i.attrs.alt==='<img src=x onerror=alert(1)>'),undefined,'xss card has no cover');
 assert.match(text(cards(page.body).find(a=>a.attrs.href==='/event/naeo-review')!),/종료/);
 assert.ok(!JSON.stringify(page.body).includes('"onerror"'),'titles are text only');
 assert.equal(page.source,'database');
});

test('event cover_image: local path validation and update',async t=>{
 const {db,admin}=await fixture(t);
 assert.throws(()=>createEvent(db,admin,{slug:'bad-cover',title:'x',status:'published',coverImage:'https://evil.test/x.png',startsAt:new Date(NOW-DAY).toISOString(),endsAt:new Date(NOW+DAY).toISOString()}));
 assert.throws(()=>createEvent(db,admin,{slug:'proto-cover',title:'x',status:'published',coverImage:'//evil.test/x.png',startsAt:new Date(NOW-DAY).toISOString(),endsAt:new Date(NOW+DAY).toISOString()}));
 const ev=createEvent(db,admin,{slug:'cover-me',title:'커버',status:'published',coverImage:'/assets/x.png',startsAt:new Date(NOW-DAY).toISOString(),endsAt:new Date(NOW+DAY).toISOString()});
 const card=cards((await buildEventListPage(db,NOW)).body).find(a=>a.attrs.href==='/event/cover-me')!;
 assert.deepEqual(all([card],n=>n.tag==='img').map(i=>[i.attrs.src,i.attrs.alt]),[['/assets/x.png','커버']]);
 updateEvent(db,admin,ev.id,{version:ev.version,coverImage:''});
 const again=cards((await buildEventListPage(db,NOW)).body).find(a=>a.attrs.href==='/event/cover-me')!;
 assert.equal(all([again],n=>n.tag==='img').length,0,'clearing the cover removes the image box');
 const detail=(await buildEventDetailPage(db,'naeo-review',{dashboard:false},NOW))!;
 assert.ok(all(detail.body,n=>n.tag==='img').some(i=>i.attrs.src==='/assets/2e11be7158d9feb4.png'),'detail shows the cover');
});

test('detail: markdown body, facts, entry mount for open events and CTA for info-only events',async t=>{
 const {db}=await fixture(t);
 const ranking=(await buildEventDetailPage(db,'ranking-reward',{dashboard:false},NOW))!;
 assert.equal(all(ranking.body,n=>n.attrs.href==='/login?next=/dashboard').length>=1,true);
 assert.equal(all(ranking.body,n=>n.attrs['data-event-entry']!==undefined).length,0);
 const review=(await buildEventDetailPage(db,'naeo-review',{dashboard:true},NOW))!;
 const mount=all(review.body,n=>n.attrs['data-event-entry']!==undefined)[0];
 assert.equal(mount.attrs['data-phase'],'ended');
 assert.equal(mount.children.length,0,'the client panel owns the mount point (no stale server text left above it)');
 assert.match(text(all(review.body,n=>n.attrs['aria-label']==='이벤트 정보')[0]),/2026\.09\.01 ~ 2026\.09\.30/);
 assert.ok(all(review.body,n=>n.tag==='h2').some(h=>/참여 방법/.test(text(h))),'markdown rendered');
 assert.equal(await buildEventDetailPage(db,'nope',{dashboard:false},NOW),null);
});

test('dashboard events show my entries and rewards',async t=>{
 const {db,admin,m}=await fixture(t);
 createBlog(db,m,{naverId:'m_blog',title:'M',category:'',isPrimary:true});
 createEvent(db,admin,{slug:'live',title:'진행 이벤트',status:'published',rewardTokens:5,startsAt:new Date(NOW-DAY).toISOString(),endsAt:new Date(NOW+DAY).toISOString()});
 const e=submitEntry(db,m,'live',{proofUrl:'https://blog.naver.com/m_blog/1'},NOW);
 reviewEntry(db,admin,e.id,{decision:'approved',version:1},NOW);
 const page=await buildDashboardEventsPage(db,m,NOW);
 const mine=all(page.body,n=>n.attrs['data-my-events']==='true')[0];
 assert.match(text(mine),/진행 이벤트승인/);assert.match(text(mine),/5토큰지급/);
 assert.ok(cards(page.body).every(a=>a.attrs.href!.startsWith('/dashboard/events/')));
});
