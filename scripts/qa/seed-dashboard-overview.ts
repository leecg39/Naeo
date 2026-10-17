/** Isolated, offline dashboard fixture. Never opens the application's configured database. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {closeSync,existsSync,openSync,writeFileSync} from 'node:fs';
import {openDatabase,type Database} from '../../src/server/database';
import {register,login} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {analyzePosts,type PostSample} from '../../src/server/analysis/rules';
import {createActionItems} from '../../src/server/analysis/action-items';
import {createKeyword,addKeywordMetric} from '../../src/server/keywords/admin-keywords';
import {createPlan} from '../../src/server/billing/plans';
import {startTrial} from '../../src/server/billing/subscriptions';
import {confirmPeriod,periodRange} from '../../src/server/ranking/ranking';
import {dashboardData} from '../../src/server/analysis/dashboard-data';
import {dashboardVisualization} from '../../src/server/analysis/dashboard-visualization';
import {dashboardOverview} from '../../src/server/analysis/dashboard-overview';
import {citationOverview} from '../../src/server/citations/runs';

const DATABASE='/tmp/naeo-dashboard-rea-2026-10-17.sqlite';
const SESSION='/tmp/naeo-dashboard-rea-2026-10-17-session.json';
const ORIGIN='http://127.0.0.1:3110';
const EMAIL='dashboard-rea@example.test',PASSWORD='Dashboard-REA-QA-only-2026!';
const DAY=86_400_000,now=Date.now()-60_000;
type FixturePost=PostSample&{id:string;keyword:string;url:string};

function posts(db:Database,blogId:string,naverId:string,count:number,theme:string):FixturePost[]{
 return Array.from({length:count},(_,i)=>{
  const id=randomUUID(),keyword=`${theme} ${['여행 코스','산책길','카페 추천','준비물','가족 여행','사진 명소','맛집 지도'][i%7]} ${i+1}`;
  const value={id,keyword,title:`${keyword} · 직접 정리한 일정과 방문 팁`,category:theme==='제주'?'여행':'일상',tags:[theme,'여행','코스'],publishedAt:now-(i+1)*DAY,url:`${ORIGIN}/dashboard/ai-picks?blog=${naverId}`};
  db.prepare('INSERT INTO blog_posts(id,blog_id,external_id,url,title,category,tags_json,published_at,collected_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,blogId,String(900000+i),value.url,value.title,value.category,JSON.stringify(value.tags),value.publishedAt,now);
  return value;
 });
}
function scan(db:Database,owner:string,blogId:string,samples:PostSample[],at:number,score?:number){
 const report=analyzePosts(samples,at);if(score!==undefined)report.score=score;
 const id=randomUUID();db.prepare('INSERT INTO scan_results(id,owner_id,blog_id,score,method_version,report_json,post_count,measured_at) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,blogId,report.score,report.methodVersion,JSON.stringify(report),samples.length,at);
 createActionItems(db,owner,id,report,at);return id;
}
function citationRun(db:Database,owner:string,blogId:string,samples:FixturePost[],at:number,step:number,empty=false){
 const run=randomUUID();
 db.prepare("INSERT INTO citation_runs(id,owner_id,blog_id,state,source,provider,post_limit,checked,progress,run_after,created_at,updated_at,completed_at) VALUES(?,?,?,'succeeded','member','offline-qa',?,?,100,?,?,?,?)").run(run,owner,blogId,samples.length,samples.length,at,at,at,at);
 samples.forEach((post,i)=>{
  const error=!empty&&step===6&&i>=samples.length-2,cited=!empty&&!error&&(i+step)%3===0,exposed=!empty&&!error&&(i+step)%4!==0,briefing=!empty&&!error&&i<10;
  const naverUrl=`https://blog.naver.com/rea_travel_blog/${900000+i}`;
  const evidence=error?{briefing:null,exposure:null,searches:0,error:{code:'QA_TIMEOUT',message:'검증용 공급자 오류'}}:{
   briefing:briefing?{markdown:`# ${post.keyword} 핵심 요약\n\n이 내용은 격리된 QA 데이터이며 내 블로그 포스팅 출처가 인용된 문장입니다 [1].\n\n- 추천 코스를 비교하고 방문 시간을 확인합니다.\n- ${post.keyword}에 필요한 교통과 준비물을 정리합니다.\n\n| 구분 | 주요 내용 |\n| --- | --- |\n| 일정 | ${post.keyword} 코스와 방문 시간 |\n| 준비 | 교통편 및 필수 준비물 확인 |\n\n검증용 설명을 통해 긴 본문과 출처 목록의 배치를 확인합니다.`,
    references:[{index:1,title:post.title,link:cited?naverUrl:post.url,source:'네이버 블로그',snippet:'대시보드 모달의 저장된 출처 표시 검증용 본문입니다.'},{index:2,title:`${post.keyword} 참고 자료`,link:`${ORIGIN}/dashboard?blog=rea_travel_blog`,source:'로컬 검증 자료',snippet:'외부 네트워크를 사용하지 않는 두 번째 출처입니다.'}],
    media:[{position:1,title:post.title,link:cited?naverUrl:post.url,thumbnail:`${ORIGIN}/event/review-2026-09/icon-coffee.webp`,platform:'네이버 블로그'}],
    questions:[`${post.keyword} 준비물은 무엇인가요?`,`${post.keyword} 방문 시 주의할 점은 무엇인가요?`]}:null,
   exposure:exposed?{section:'organic_results',position:i+1}:null,searches:1};
  db.prepare(`INSERT INTO citation_results(id,run_id,owner_id,blog_id,post_id,keyword,keyword_source,status,briefing,exposed,text_rank,image_rank,evidence_json,checked_at)
   VALUES(?,?,?,?,?,?,'title',?,?,?,?,?,?,?)`).run(randomUUID(),run,owner,blogId,post.id,post.keyword,error?'error':'checked',briefing?1:0,exposed?1:0,cited&&briefing?i%5+1:null,cited&&briefing&&i%2===0?i%3+1:null,JSON.stringify(evidence),at+i);
 });
}
function recommendations(db:Database,owner:string,blogId:string,samples:FixturePost[],count:number){
 for(let i=0;i<count;i++){
  const phrase=`${samples[0].category} 새 글감 ${i+1}`,signal=(['new','revisit','rewritten','opportunity'] as const)[i%4],total=i===5?null:2000+i*350,documents=total===null?null:i%5===0?300:3000+i*250;
  const sourcePost=i%3===0?samples[i%samples.length].id:null,at=now-(i%7)*DAY;
  db.prepare(`INSERT INTO member_recommendations(id,owner_id,blog_id,phrase,phrase_key,category,signal,score,reason,source,source_post_id,pc_volume,mobile_volume,document_count,measured_at,history_json,related_json,competition_json,written,recommended_at,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,'blog_analysis',?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),owner,blogId,phrase,phrase.replace(/\s/g,''),samples[0].category,signal,95-i,`기존 ${samples[0].keyword} 글을 바탕으로 만든 격리 QA 추천입니다.`,sourcePost,total===null?null:Math.floor(total*.25),total===null?null:total-Math.floor(total*.25),documents,total===null?null:at,
   JSON.stringify(total===null?[]:[{at:at-DAY,pcVolume:400,mobileVolume:1300,total:1700,documentCount:documents,saturation:documents!/1700,source:'manual'},{at,pcVolume:Math.floor(total*.25),mobileVolume:total-Math.floor(total*.25),total,documentCount:documents,saturation:documents!/total,source:'manual'}]),
   JSON.stringify([{phrase:`${phrase} 준비`,pcVolume:100,mobileVolume:300,total:400,source:'blog_analysis'}]),JSON.stringify({blogs:[],news:[],checkedAt:now,error:null}),i===8?1:0,at,at,at);
 }
 db.prepare("INSERT INTO recommendation_builds(id,owner_id,blog_id,state,source,new_count,started_at,completed_at,lease_until,notice) VALUES(?,?,?,'succeeded','local',?,?,?,?,?)").run(randomUUID(),owner,blogId,count,now-1000,now,now,'격리 QA 검증용 추천입니다. 외부 공급자는 호출하지 않았습니다.');
}

async function main(){
 // A fixed /tmp target and exclusive creation protect both existing fixtures and real databases.
 assert.ok(![DATABASE,`${DATABASE}-wal`,`${DATABASE}-shm`,SESSION].some(existsSync),'QA 파일이 이미 있습니다. 기존 QA 서버를 종료하고 해당 /tmp 파일만 정리한 후 다시 실행하세요.');
 closeSync(openSync(DATABASE,'wx',0o600));
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Offline QA fixture must not access the network');};
 const db=openDatabase(DATABASE);
 try{
  const account=await register(db,{email:EMAIL,password:PASSWORD,nickname:'대시보드 QA 여행기',termsAccepted:true});
  const owner=account.user.id;
  const empty=await register(db,{email:'dashboard-empty@example.test',password:PASSWORD,nickname:'진단 전 QA',termsAccepted:true});
  const peer1=await register(db,{email:'dashboard-peer-one@example.test',password:PASSWORD,nickname:'경제 QA',termsAccepted:true});
  const peer2=await register(db,{email:'dashboard-peer-two@example.test',password:PASSWORD,nickname:'여행 동료 QA',termsAccepted:true});
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(peer1.user.id);
  db.prepare('UPDATE profiles SET ranking_public=1 WHERE user_id IN (?,?,?)').run(owner,peer1.user.id,peer2.user.id);
  const primary=createBlog(db,owner,{naverId:'rea_travel_blog',title:'제주 여행을 기록하는 블로그',category:'여행',isPrimary:true});
  const secondary=createBlog(db,owner,{naverId:'rea_daily_blog',title:'일상의 작은 발견',category:'일상'});
  const economy=createBlog(db,peer1.user.id,{naverId:'rea_economy_blog',title:'경제 QA 블로그',category:'경제',isPrimary:true});
  const travel=createBlog(db,peer2.user.id,{naverId:'rea_peer_blog',title:'여행 동료 QA 블로그',category:'여행',isPrimary:true});
  const samples=posts(db,primary.id,primary.naverId,14,'제주'),secondaryPosts=posts(db,secondary.id,secondary.naverId,4,'일상');
  createPlan(db,peer1.user.id,{code:'qa-basic',name:'베이직 QA',price:9900,monthlyTokens:750,trialDays:30});startTrial(db,owner,{planCode:'qa-basic'},now);
  samples.forEach((sample,i)=>{const keyword=createKeyword(db,peer1.user.id,{phrase:sample.keyword,category:'여행'},now-DAY);addKeywordMetric(db,peer1.user.id,keyword.id,{pcVolume:400+i*50,mobileVolume:1600+i*100,documentCount:i===0?400:1000+i*300},now-DAY);});
  [['제주',1200,4800,1800],['여행',900,3100,5200],['코스',500,1500,900]].forEach(([phrase,pcVolume,mobileVolume,documentCount])=>{const kw=createKeyword(db,peer1.user.id,{phrase:String(phrase),category:'여행'},now-DAY);addKeywordMetric(db,peer1.user.id,kw.id,{pcVolume:Number(pcVolume),mobileVolume:Number(mobileVolume),documentCount:Number(documentCount)},now-DAY);});
  for(const [step,days] of [85,45,20,6,2,1,0.02].entries()){
   const at=Math.floor(now-days*DAY);scan(db,owner,primary.id,samples.slice(0,Math.min(14,4+step*2)),at,55+step*5);citationRun(db,owner,primary.id,samples,at+10_000,step);
  }
  scan(db,owner,secondary.id,secondaryPosts,now-DAY,63);citationRun(db,owner,secondary.id,secondaryPosts,now-3600_000,0,true);
  // Historical ranks are genuinely confirmed snapshots, then compared with current measurements.
  for(const period of ['month','week'] as const)for(const offset of [-2,-1]){
   const range=periodRange(period,offset,now),at=range.end-60_000;
   scan(db,owner,primary.id,samples,at,60);scan(db,peer1.user.id,economy.id,[],at,92);scan(db,peer2.user.id,travel.id,[],at,75);confirmPeriod(db,period,offset,now);
  }
  scan(db,owner,primary.id,samples,now-120_000,85);scan(db,peer1.user.id,economy.id,[],now-110_000,95);scan(db,peer2.user.id,travel.id,[],now-100_000,70);
  recommendations(db,owner,primary.id,samples,16);recommendations(db,owner,secondary.id,secondaryPosts,2);
  const data=dashboardData(db,owner,now),citation=citationOverview(db,owner,{blogId:primary.id,config:null,now}),summary=dashboardOverview(db,owner,data,citation,dashboardVisualization(db,owner,data,citation));
  assert.ok(summary.monitoring.length>=8);assert.ok(summary.changes.some(c=>c.kind==='citation_gained'));assert.ok(summary.changes.some(c=>c.kind==='citation_lost'));assert.equal(summary.recommendations.length,12);assert.equal(summary.metrics.checked,12);
  assert.equal(summary.rankings.find(r=>r.scope==='all')?.cards.find(c=>c.period==='week')?.rank,2);
  const loggedIn=await login(db,{email:EMAIL,password:PASSWORD});assert.equal(loggedIn.user.id,owner);
  writeFileSync(SESSION,JSON.stringify({origin:ORIGIN,token:loggedIn.session.token,email:EMAIL,password:PASSWORD,emptyEmail:empty.user.email,primaryBlogId:primary.id,secondaryBlogId:secondary.id},null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({database:DATABASE,origin:ORIGIN,email:EMAIL,password:PASSWORD,emptyEmail:empty.user.email,sessionFile:SESSION,primaryBlog:'rea_travel_blog',secondaryBlog:'rea_daily_blog',metrics:summary.metrics,gallery:summary.monitoring.length,changes:summary.changes.length,rankings:summary.rankings.map(r=>({scope:r.scope,cards:r.cards.map(c=>({period:c.period,rank:c.rank,delta:c.delta}))})),offline:true},null,2));
 }finally{db.close();globalThis.fetch=originalFetch;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
