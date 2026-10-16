import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {saveScanResult} from '../../src/server/analysis/results';
import {analyzePosts} from '../../src/server/analysis/rules';
import {buildRankingPage} from '../../src/server/ranking/ranking-page';
import {confirmPeriod,periodRange} from '../../src/server/ranking/ranking';
import type {CapturedNode} from '../../src/types/site';

type El=Exclude<CapturedNode,string>;
const all=(nodes:CapturedNode[],f:(n:El)=>boolean,out:El[]=[]):El[]=>{for(const n of nodes){if(typeof n==='string')continue;if(f(n))out.push(n);all(n.children,f,out);}return out;};
const text=(n:CapturedNode):string=>typeof n==='string'?n:n.children.map(text).join('');
const NOW=Date.parse('2026-10-14T03:00:00Z');
const DAY=86_400_000;

async function member(db:Database,email:string,nickname:string,isPublic=true){
 const u=(await register(db,{email,password:'ranking-page-pass',nickname,termsAccepted:true})).user;
 db.prepare('UPDATE profiles SET ranking_public=? WHERE user_id=?').run(isPublic?1:0,u.id);
 const blog=createBlog(db,u.id,{naverId:email.split('@')[0],title:'블로그',category:'여행',isPrimary:true});
 return{id:u.id,blog:blog.id};
}
function scored(db:Database,m:{id:string;blog:string},at:number){
 const report=analyzePosts(Array.from({length:8},(_,i)=>({title:'제주 여행 코스 총정리 가이드 '+i,category:'여행',tags:['a','b','c'],publishedAt:at-i*DAY})),at);
 db.prepare("INSERT INTO scan_jobs(id,owner_id,blog_id,state,run_after,created_at,updated_at) VALUES(?,?,?,'succeeded',?,?,?)").run(`j-${m.id}-${at}`,m.id,m.blog,at,at,at);
 saveScanResult(db,{ownerId:m.id,blogId:m.blog,jobId:`j-${m.id}-${at}`,report,postCount:8,measuredAt:at});
 return report;
}
async function fixture(t:TestContext){const db=openDatabase(':memory:');t.after(()=>db.close());return db;}

test('captured third-party ranking data is removed; empty ranking explains how to join',async t=>{
 const db=await fixture(t);
 const page=await buildRankingPage(db,{},null,NOW);
 assert.equal(all(page.body,n=>/blog\.naver\.com/.test(n.attrs.href??'')).length,0,'no captured blog links');
 assert.equal(all(page.body,n=>n.attrs['data-rank']!==undefined).length,0);
 assert.ok(!/AI 본문|AI 이미지/.test(JSON.stringify(page.body)),'unmeasured AI citation columns removed');
 assert.match(JSON.stringify(page.body),/랭킹 공개/);
 assert.match(JSON.stringify(page.body),/새 규칙/);
});

test('rows, tabs, my rank, categories and hall of fame come from the database',async t=>{
 const db=await fixture(t);
 const a=await member(db,'alpha@example.test','알파');const b=await member(db,'bravo@example.test','브라보');const hidden=await member(db,'hidden@example.test','비공개',false);
 const last=periodRange('week',-1,NOW);
 scored(db,a,last.start+DAY);confirmPeriod(db,'week',-1,NOW);
 const report=scored(db,a,NOW-DAY);scored(db,b,NOW-DAY+1000);scored(db,hidden,NOW-DAY);
 const page=await buildRankingPage(db,{period:'week'},a.id,NOW);
 const rows=all(page.body,n=>n.attrs['data-rank']!==undefined);
 assert.deepEqual(rows.map(r=>r.attrs['data-rank']),['1','2']);
 assert.match(text(rows[0]),/알파/);assert.match(text(rows[0]),new RegExp(`${report.score}점`));
 assert.equal(all([rows[0]],n=>n.tag==='a'&&n.attrs.href==='https://blog.naver.com/alpha').length,1);
 assert.match(text(rows[0]),/주간 1위 1회/,'title from confirmed snapshot');
 assert.ok(!JSON.stringify(page.body).includes('비공개'),'private members never appear');
 const tabs=all(page.body,n=>n.attrs.role==='tab');
 assert.deepEqual(tabs.map(t=>[t.attrs['data-period'],t.attrs['aria-selected']]),[['all','false'],['month','false'],['week','true']]);
 assert.match(text(all(page.body,n=>(n.attrs.class??'').includes('mui-gtw5ek'))[0]),/1위/);
 assert.match(JSON.stringify(page.body),/"여행"/);
 assert.match(JSON.stringify(page.body),/명예의 전당/);
 const privatePage=await buildRankingPage(db,{period:'week'},hidden.id,NOW);
 assert.match(text(all(privatePage.body,n=>(n.attrs.class??'').includes('mui-gtw5ek'))[0]),/랭킹 비공개/);
});

test('podium shows the top 3 with scores and titles; riser needs previous-week data',async t=>{
 const db=await fixture(t);
 const a=await member(db,'alpha@example.test','알파');const b=await member(db,'bravo@example.test','브라보');const c=await member(db,'charlie@example.test','찰리');
 const last=periodRange('week',-1,NOW);
 scored(db,b,last.start+DAY);scored(db,a,last.start+2*DAY);
 confirmPeriod(db,'week',-1,NOW);
 scored(db,a,NOW-2*DAY);scored(db,b,NOW-DAY);scored(db,c,NOW-DAY);
 const page=await buildRankingPage(db,{period:'week'},null,NOW);
 const podium=all(page.body,n=>/podium-name/.test(n.attrs.class??''));
 assert.deepEqual(podium.map(text).sort(),['브라보','알파','찰리'].sort());
 assert.match(JSON.stringify(page.body),/▲1계단/,'riser: 알파 climbed 2→1 since last week');
 const mine=await buildRankingPage(db,{period:'week'},a.id,NOW);
 assert.match(text(all(mine.body,n=>(n.attrs.class??'').includes('mui-gtw5ek'))[0]),/상위 \d+%/,'percentile line');
 const thin=await buildRankingPage(await fixture(t),{},null,NOW);
 assert.equal(all(thin.body,n=>/podium-name/.test(n.attrs.class??'')).length,0,'no podium without 3 members');
});
