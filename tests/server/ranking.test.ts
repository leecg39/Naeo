import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {saveScanResult} from '../../src/server/analysis/results';
import {analyzePosts,type AnalysisReport} from '../../src/server/analysis/rules';
import {periodRange,liveRanking,confirmPeriod,champions,memberHistory,titlesOf} from '../../src/server/ranking/ranking';

const DAY=86_400_000;
const NOW=Date.parse('2026-10-14T03:00:00Z'); // 수요일 12:00 KST (이번 주 월요일 = NOW-2일)
async function member(db:Database,email:string,{nickname,publicRank=true,category='여행'}:{nickname:string;publicRank?:boolean;category?:string}){
 const u=(await register(db,{email,password:'ranking-long-password',nickname,termsAccepted:true})).user;
 db.prepare('UPDATE profiles SET ranking_public=? WHERE user_id=?').run(publicRank?1:0,u.id);
 const blog=createBlog(db,u.id,{naverId:email.split('@')[0].replace(/[^a-z0-9]/g,''),title:`${nickname} 블로그`,category,isPrimary:true});
 return{id:u.id,blog:blog.id};
}
const report=(score:number):AnalysisReport=>({...analyzePosts([],NOW),score});
function scored(db:Database,m:{id:string;blog:string},score:number,at:number){
 db.prepare("INSERT INTO scan_jobs(id,owner_id,blog_id,state,run_after,created_at,updated_at,completed_at) VALUES(?,?,?,'succeeded',?,?,?,?)").run(`job-${m.id}-${at}`,m.id,m.blog,at,at,at,at);
 saveScanResult(db,{ownerId:m.id,blogId:m.blog,jobId:`job-${m.id}-${at}`,report:report(score),postCount:10,measuredAt:at});
}
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const a=await member(db,'alpha@example.test',{nickname:'알파'});
 const b=await member(db,'bravo@example.test',{nickname:'브라보',category:'맛집'});
 const c=await member(db,'charlie@example.test',{nickname:'찰리'});
 const hidden=await member(db,'hidden@example.test',{nickname:'비공개',publicRank:false});
 return{db,a,b,c,hidden};
}

test('periods follow KST weeks (Mon-Sun) and calendar months',()=>{
 const w=periodRange('week',0,NOW);
 assert.equal(new Date(w.start).toISOString(),'2026-10-11T15:00:00.000Z','Monday 00:00 KST');
 assert.equal(w.end-w.start,7*DAY);
 assert.equal(periodRange('week',-1,NOW).end,w.start);
 const m=periodRange('month',0,NOW);
 assert.equal(new Date(m.start).toISOString(),'2026-09-30T15:00:00.000Z');assert.equal(new Date(m.end).toISOString(),'2026-10-31T15:00:00.000Z');
 assert.equal(periodRange('all',0,NOW).start,0);
});

test('live ranking: public members only, latest score in period, deterministic ties, filters and my rank',async t=>{
 const {db,a,b,c,hidden}=await fixture(t);
 scored(db,a,70,NOW-2*DAY+3600_000);scored(db,a,90,NOW-DAY);   // 이번 주 최신 = 90
 scored(db,b,90,NOW-2*DAY);                            // same score, earlier → ahead of alpha
 scored(db,c,60,NOW-DAY);
 scored(db,hidden,99,NOW-DAY);
 const r=liveRanking(db,{period:'week'},a.id,NOW);
 assert.deepEqual(r.data.map(x=>[x.rank,x.nickname,x.score]),[[1,'브라보',90],[2,'알파',90],[3,'찰리',60]]);
 assert.equal(r.total,3,'opted-out members are not ranked');
 assert.equal(r.me?.rank,2);assert.equal(r.me?.public,true);
 assert.equal(liveRanking(db,{period:'week',category:'맛집'},null,NOW).data.length,1);
 assert.equal(liveRanking(db,{period:'week',q:'찰'},null,NOW).data[0].nickname,'찰리');
 assert.deepEqual(liveRanking(db,{period:'week'},hidden.id,NOW).me,{public:false,rank:null,score:99});
 assert.ok(!('email' in r.data[0]),'no private fields');
 assert.equal(r.categories.find(x=>x.name==='여행')?.count,2);
 assert.equal(liveRanking(db,{period:'week',offset:-1},null,NOW).total,0,'nothing measured last week');
});

test('confirming a finished period snapshots ranks once; champions, titles and history follow',async t=>{
 const {db,a,b}=await fixture(t);
 const lastWeek=periodRange('week',-1,NOW);
 scored(db,a,80,lastWeek.start+DAY);scored(db,b,70,lastWeek.start+DAY);
 assert.throws(()=>confirmPeriod(db,'week',0,NOW),{status:409,code:'PERIOD_NOT_FINISHED'});
 const snap=confirmPeriod(db,'week',-1,NOW);
 assert.equal(snap.entries,2);
 assert.equal(confirmPeriod(db,'week',-1,NOW).entries,2,'idempotent');
 scored(db,b,99,lastWeek.start+2*DAY);
 assert.equal(liveRanking(db,{period:'week',offset:-1},null,NOW).data[0].nickname,'알파','confirmed snapshot is not rewritten by late results');
 assert.equal(liveRanking(db,{period:'week',offset:-1},null,NOW).confirmed,true);
 assert.deepEqual(champions(db).map(x=>[x.periodType,x.nickname]),[['week','알파']]);
 assert.deepEqual(titlesOf(db,a.id),['주간 1위 1회']);
 assert.deepEqual(memberHistory(db,b.id).map(h=>[h.periodType,h.rank]),[['week',2]]);
});
