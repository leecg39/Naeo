import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {listCompetitors,addCompetitor,updateCompetitor,deleteCompetitor,refreshCompetitor,COMPETITOR_LIMIT} from '../../src/server/competitors/competitors';

const NOW=Date.parse('2026-10-13T03:00:00Z');
const DAY=86_400_000;
const rss=(id:string,n:number)=>`<rss><channel><title>${id} 블로그</title>${Array.from({length:n},(_,i)=>`<item><title>제주 여행 코스 총정리 ${i+1}편 가이드</title><link>https://blog.naver.com/${id}/${3000+i}</link><category>여행</category><tag>a,b,c</tag><pubDate>${new Date(NOW-i*DAY).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
const ok=(id:string,n=5)=>async()=>new Response(rss(id,n),{status:200});

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const a=(await register(db,{email:'a@example.test',password:'competitor-password',nickname:'A',termsAccepted:true})).user.id;
 const b=(await register(db,{email:'b@example.test',password:'competitor-password',nickname:'B',termsAccepted:true})).user.id;
 return{db,a,b};
}
const audits=(db:Database,action:string)=>(db.prepare('SELECT count(*) AS n FROM audit_logs WHERE action=?').get(action) as {n:number}).n;

test('add validates blog input, prevents duplicates and enforces the per-member limit',async t=>{
 const {db,a,b}=await fixture(t);
 const c=addCompetitor(db,a,{blog:'https://blog.naver.com/Rival_Blog',note:'여행 경쟁자'},NOW);
 assert.equal(c.naverId,'rival_blog');assert.equal(c.note,'여행 경쟁자');assert.equal(c.snapshot,null);
 assert.throws(()=>addCompetitor(db,a,{blog:'rival_blog'},NOW),{status:409,code:'COMPETITOR_EXISTS'});
 assert.equal(addCompetitor(db,b,{blog:'rival_blog'},NOW).naverId,'rival_blog','another member may track the same blog');
 assert.throws(()=>addCompetitor(db,a,{blog:'https://evil.example/x'},NOW),{status:400,code:'INVALID_BLOG'});
 for(let i=1;i<COMPETITOR_LIMIT;i++)addCompetitor(db,a,{blog:`rival_${i}`},NOW);
 assert.throws(()=>addCompetitor(db,a,{blog:'one_too_many'},NOW),{status:409,code:'COMPETITOR_LIMIT'});
 assert.equal(listCompetitors(db,a).data.length,COMPETITOR_LIMIT);
 assert.equal(listCompetitors(db,b).data.length,1,'members are isolated');
});

test('refresh collects public RSS into a snapshot with score, rate limited per competitor',async t=>{
 const {db,a,b}=await fixture(t);
 const c=addCompetitor(db,a,{blog:'rival_blog'},NOW);
 const fresh=await refreshCompetitor(db,a,c.id,ok('rival_blog',6),NOW);
 assert.equal(fresh.snapshot?.postCount,6);assert.equal(fresh.snapshot?.report.criteria.length,5);
 assert.equal(fresh.snapshot?.blogTitle,'rival_blog 블로그');assert.equal(fresh.lastCollectedAt,NOW);
 await assert.rejects(refreshCompetitor(db,a,c.id,ok('rival_blog'),NOW+60_000),{status:429,code:'REFRESH_TOO_SOON'});
 await assert.rejects(refreshCompetitor(db,b,c.id,ok('rival_blog'),NOW+11*60_000),{status:404},'cannot refresh someone else\'s competitor');
 const failed=addCompetitor(db,a,{blog:'ghost_blog'},NOW);
 await assert.rejects(refreshCompetitor(db,a,failed.id,async()=>new Response('<rss><channel><title/></channel></rss>'),NOW),{status:404,code:'BLOG_NOT_FOUND'});
 const after=listCompetitors(db,a).data.find(x=>x.id===failed.id)!;
 assert.equal(after.lastError,'BLOG_NOT_FOUND','failure recorded for the screen');
});

test('memo edit with versions, delete, audit and comparison against my latest score',async t=>{
 const {db,a,b}=await fixture(t);
 const c=addCompetitor(db,a,{blog:'rival_blog'},NOW);
 const edited=updateCompetitor(db,a,c.id,{note:'주 3회 발행',version:1});
 assert.equal(edited.note,'주 3회 발행');assert.equal(edited.version,2);
 assert.throws(()=>updateCompetitor(db,a,c.id,{note:'x',version:1}),{status:409,code:'VERSION_CONFLICT'});
 assert.throws(()=>updateCompetitor(db,b,c.id,{note:'x',version:2}),{status:404});
 assert.throws(()=>updateCompetitor(db,a,c.id,{note:'x'.repeat(501),version:2}),{name:'ZodError'});
 const list=listCompetitors(db,a);
 assert.equal(list.mine,null,'no own diagnosis yet');
 assert.throws(()=>deleteCompetitor(db,b,c.id,{version:2}),{status:404});
 deleteCompetitor(db,a,c.id,{version:2});
 assert.equal(listCompetitors(db,a).data.length,0);
 for(const x of ['competitor.create','competitor.update','competitor.delete'])assert.ok(audits(db,x)>=1,x);
});
