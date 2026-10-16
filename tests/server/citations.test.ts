import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {citationConfig,serpApiProvider,CitationError,briefingOf,resultLinks,type CitationConfig,type CitationProvider,type SearchEvidence} from '../../src/server/citations/provider';
import {naverPostRef,matchCitation} from '../../src/server/citations/match';
import {autoKeyword,setPostKeyword,removePostKeyword} from '../../src/server/citations/keywords';
import {enqueueCitation,getCitationRun,cancelCitationRun,citationOverview,citationDetail,markCitationViewed,DAILY_CITATION_LIMIT} from '../../src/server/citations/runs';
import {runCitationOnce,CITATION_LEASE_MS,fitEvidence} from '../../src/server/citations/worker';
import {tutorial,finishTutorial} from '../../src/server/engagement/service';
import {runRetention} from '../../src/server/ops/retention';
import {datasets} from '../../src/server/privacy/datasets';
import {scanHandler} from '../../src/server/analysis/scan-handler';
import {enqueueScan,claimNextScan} from '../../src/server/jobs/queue';

const config:CitationConfig={provider:'serpapi',apiKey:'k'.repeat(64),base:'http://127.0.0.1:9',device:'desktop'};
const NOW=Date.UTC(2026,9,16,3,0,0);
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const make=async(email:string)=>(await register(db,{email,password:'citation-long-password',nickname:'인용',termsAccepted:true})).user.id;
 const owner=await make('owner@example.test'),other=await make('other@example.test');
 const blog=createBlog(db,owner,{naverId:'cite_blog',title:'인용 블로그',category:'',isPrimary:true}).id;
 const post=(logNo:string,title:string,tags:string[],category='여행',published=NOW-Number(logNo)*1000)=>{const id=randomUUID();db.prepare('INSERT INTO blog_posts(id,blog_id,external_id,url,title,excerpt,category,tags_json,published_at,collected_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,blog,logNo,`https://blog.naver.com/cite_blog/${logNo}`,title,'',category,JSON.stringify(tags),published,NOW);return id;};
 return{db,owner,other,blog,post};
}
const evidence=(over:Partial<SearchEvidence>={}):SearchEvidence=>({briefing:null,links:[],searches:1,...over});
const briefing=(refs:string[],media:string[]=[])=>({markdown:'요약 [1]',references:refs.map((link,i)=>({index:i+1,title:`출처 ${i+1}`,link,source:'블로그',snippet:''})),media:media.map((link,i)=>({position:i+1,title:`이미지 ${i+1}`,link,thumbnail:'',platform:'블로그'})),questions:['다음에 궁금한 것']});
const count=(db:Database,sql:string,...p:string[])=>(db.prepare(sql).get(...p) as {n:number}).n;

test('configuration requires the explicit provider and key; endpoint override is loopback only',()=>{
 assert.equal(citationConfig({}),null);
 assert.equal(citationConfig({NAEO_CITATION_PROVIDER:'serpapi'}),null);
 assert.equal(citationConfig({NAEO_CITATION_PROVIDER:'serpapi',NAEO_SERPAPI_KEY:'short'}),null);
 const key='a1'.repeat(32);
 assert.deepEqual(citationConfig({NAEO_CITATION_PROVIDER:'serpapi',NAEO_SERPAPI_KEY:key}),{provider:'serpapi',apiKey:key,base:'https://serpapi.com',device:'desktop'});
 assert.equal(citationConfig({NAEO_CITATION_PROVIDER:'serpapi',NAEO_SERPAPI_KEY:key,NAEO_CITATION_DEVICE:'mobile'})?.device,'mobile');
 assert.equal(citationConfig({NAEO_CITATION_PROVIDER:'serpapi',NAEO_SERPAPI_KEY:key,NAEO_SERPAPI_BASE:'http://127.0.0.1:4001'})?.base,'http://127.0.0.1:4001');
 for(const base of ['https://evil.example','http://10.0.0.5','http://user:pw@127.0.0.1:1','http://127.0.0.1:1/path','not a url'])assert.equal(citationConfig({NAEO_CITATION_PROVIDER:'serpapi',NAEO_SERPAPI_KEY:key,NAEO_SERPAPI_BASE:base}),null,base);
});

test('naver post references cover desktop, mobile and PostView forms and reject other hosts',()=>{
 assert.deepEqual(naverPostRef('https://blog.naver.com/Cite_Blog/223650938104?fromRss=true'),{naverId:'cite_blog',logNo:'223650938104'});
 assert.deepEqual(naverPostRef('https://m.blog.naver.com/cite_blog/42'),{naverId:'cite_blog',logNo:'42'});
 assert.deepEqual(naverPostRef('https://blog.naver.com/PostView.naver?blogId=cite_blog&logNo=7'),{naverId:'cite_blog',logNo:'7'});
 assert.deepEqual(naverPostRef('https://m.blog.naver.com/PostView.nhn?blogId=cite_blog&logNo=x'),{naverId:'cite_blog',logNo:null});
 assert.deepEqual(naverPostRef('https://blog.naver.com/cite_blog'),{naverId:'cite_blog',logNo:null});
 for(const bad of ['https://blog.naver.com.evil.example/cite_blog/1','https://cafe.naver.com/cite_blog/1','javascript:alert(1)','https://blog.naver.com/%2e%2e/1','not a url'])assert.equal(naverPostRef(bad),null,bad);
});

test('representative keyword: first usable tag, then the first title clause within 30 characters',()=>{
 assert.deepEqual(autoKeyword('제목',['#  ','#제주 여행','맛집']),{keyword:'제주 여행',source:'tag'});
 assert.deepEqual(autoKeyword('[공지] 군포시 2년 이상 운영 중소기업, 우수기업 신청자격 확인하세요~',[]),{keyword:'군포시 2년 이상 운영 중소기업',source:'title'});
 assert.deepEqual(autoKeyword('🍜 서울 냉면 맛집 베스트 다섯 곳을 정리한 아주 긴 제목입니다 - 2편',[]),{keyword:'서울 냉면 맛집 베스트 다섯 곳을 정리한 아주 긴',source:'title'});
 assert.equal(autoKeyword('!',[]),null);
 assert.equal(autoKeyword('',['a']),null);
});

test('SerpApi adapter: fixed endpoint, follow-up briefing by token, bounded fields, ads excluded',async()=>{
 const calls:URL[]=[];
 const fetchImpl=async(url:string,init?:RequestInit)=>{
  const u=new URL(url);calls.push(u);
  assert.equal(init?.redirect,'error');
  if(u.searchParams.get('engine')==='naver')return Response.json({
   search_metadata:{id:'x',json_endpoint:'https://serpapi.com/searches/x.json'},
   ads_results:[{link:'https://blog.naver.com/cite_blog/1'}],
   web_results:[{position:1,link:'https://example.com/a',related_documents:[{link:'https://m.blog.naver.com/cite_blog/2'}]}],
   blog_results:[{link:'javascript:alert(1)'},{link:'https://blog.naver.com/cite_blog/3'}],
   ai_briefing:{page_token:'tok_123456789',serpapi_link:'https://evil.example/steal'}
  });
  return Response.json({markdown:'커피는 [1]'+'가'.repeat(20000),references:[{index:1,title:'내 글',link:'https://blog.naver.com/cite_blog/2',source:'블로그'},{index:2,title:'나쁜 링크',link:'javascript:alert(1)'}],media:[{position:3,title:'사진',link:'https://m.blog.naver.com/PostView.naver?blogId=cite_blog&logNo=9',thumbnail:'data:image/png;base64,xx'}],related_questions:[{question:'커피 효능은?'},{question:''}]});
 };
 const result=await serpApiProvider(config,fetchImpl)('제주 여행');
 assert.equal(calls.length,2);
 assert.ok(calls.every(u=>u.origin==='http://127.0.0.1:9'&&u.pathname==='/search.json'&&u.searchParams.get('api_key')===config.apiKey&&u.searchParams.get('device')==='desktop'));
 assert.equal(calls[0].searchParams.get('query'),'제주 여행');
 assert.equal(calls[1].searchParams.get('engine'),'naver_ai_overview');assert.equal(calls[1].searchParams.get('page_token'),'tok_123456789');assert.equal(calls[1].searchParams.get('query'),null);
 assert.equal(result.searches,2);
 assert.equal(result.briefing!.markdown.length,12000);
 assert.deepEqual(result.briefing!.references.map(r=>r.index),[1],'javascript: references are dropped');
 assert.equal(result.briefing!.media[0].thumbnail,'','only http(s) thumbnails are kept');
 assert.deepEqual(result.briefing!.questions,['커피 효능은?']);
 assert.deepEqual(result.links.map(l=>[l.section,l.position,l.link]),[['web_results',1,'https://example.com/a'],['web_results',1,'https://m.blog.naver.com/cite_blog/2'],['blog_results',2,'https://blog.naver.com/cite_blog/3']]);
 const m=matchCitation(result,'CITE_BLOG','3');
 assert.deepEqual(m,{briefing:true,exposed:true,textRank:1,imageRank:3,exposure:{section:'blog_results',position:2}});
 assert.equal(matchCitation(result,'cite_blog','2').exposed,true);
 assert.equal(matchCitation(result,'other_blog','3').textRank,null);
 assert.equal(briefingOf({markdown:'',references:[],media:[]}),null);
 assert.equal(resultLinks({pagination:[{link:'https://blog.naver.com/a/1'}]}).length,0);
});

test('SerpApi adapter maps provider failures to retryable or terminal errors and keeps the key out of messages',async()=>{
 const reply=(status:number,body:unknown)=>serpApiProvider(config,async()=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json'}}))('키워드');
 const fails=async(p:Promise<unknown>,code:string,retryable:boolean,scope:'run'|'query')=>{
  await assert.rejects(p,(e:unknown)=>{assert.ok(e instanceof CitationError);assert.equal(e.code,code);assert.equal(e.retryable,retryable);assert.equal(e.scope,scope);assert.ok(!e.message.includes(config.apiKey));return true;});
 };
 await fails(reply(401,{error:'Invalid API key.'}),'CITATION_PROVIDER_AUTH',false,'run');
 await fails(reply(429,{error:'Your account has run out of searches.'}),'CITATION_PROVIDER_QUOTA',false,'run');
 await fails(reply(429,{error:'Too many requests per hour'}),'CITATION_PROVIDER_BUSY',true,'run');
 await fails(reply(503,'oops'),'CITATION_PROVIDER_BUSY',true,'run');
 await fails(reply(400,{error:'Unsupported query'}),'CITATION_QUERY_FAILED',false,'query');
 await fails(reply(200,'not json'),'CITATION_RESPONSE_INVALID',true,'run');
 await fails(reply(200,{error:'Something else went wrong'}),'CITATION_QUERY_FAILED',false,'query');
 await fails(serpApiProvider(config,async()=>{throw new TypeError(`redirect ${config.apiKey}`);})('키워드'),'CITATION_PROVIDER_UNAVAILABLE',true,'run');
 await fails(serpApiProvider(config,async()=>new Response('x'.repeat(3*1024*1024+1)))('키워드'),'CITATION_RESPONSE_TOO_LARGE',false,'query');
 assert.deepEqual(await reply(200,{error:"Naver hasn't returned any results for this query."}),{briefing:null,links:[],searches:1});
});

test('run lifecycle: one search per distinct keyword, citation matching, overview, detail marks, viewed tutorial reward',async t=>{
 const {db,owner,blog,post}=await fixture(t);
 const a=post('3','제주 여행 코스',['제주 여행']),b=post('2','제주 여행 2일차',['제주 여행']),c=post('1','부산 맛집',['부산 맛집'],'');
 assert.equal(tutorial(db,owner,NOW).steps.find(s=>s.key==='ai_picks')!.eligible,false);
 const run=enqueueCitation(db,owner,{blogId:blog,idempotencyKey:'k1'},{source:'member',config},NOW);
 assert.equal(enqueueCitation(db,owner,{blogId:blog,idempotencyKey:'k1'},{source:'member',config},NOW).id,run.id,'same key returns the same run');
 assert.throws(()=>enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW),{status:409,code:'CITATION_IN_PROGRESS'});
 const asked:string[]=[];
 const provider:CitationProvider=async keyword=>{asked.push(keyword);return keyword==='제주 여행'?evidence({briefing:briefing(['https://example.com/x','https://m.blog.naver.com/cite_blog/2'],['https://blog.naver.com/cite_blog/3']),links:[{link:'https://blog.naver.com/cite_blog/3',section:'blog_results',position:2}],searches:2}):evidence();};
 assert.equal(await runCitationOnce(db,'w1',provider,()=>NOW+1000),run.id);
 assert.deepEqual(asked,['부산 맛집','제주 여행'],'newest post first; duplicate keywords are searched once');
 const done=getCitationRun(db,owner,run.id);
 assert.equal(done.state,'succeeded');assert.equal(done.checked,3);assert.equal(done.progress,100);
 assert.equal(count(db,'SELECT searches AS n FROM citation_runs WHERE id=?',run.id),3);
 const view=citationOverview(db,owner,{config,now:NOW+2000});
 const report=view.report!;
 assert.equal(report.total,3);assert.equal(report.cited,2);assert.equal(report.textCited,2);assert.equal(report.imageCited,2);assert.equal(report.exposed,1);assert.equal(report.briefing,2);
 assert.deepEqual(report.categories,[{name:'여행',total:2,cited:2,exposed:1},{name:'미분류',total:1,cited:0,exposed:0}]);
 const rowA=report.rows.find(r=>r.postId===a)!,rowC=report.rows.find(r=>r.postId===c)!;
 assert.equal(rowA.exposed,true);assert.equal(rowA.textRank,2);assert.equal(rowA.imageRank,1);
 assert.equal(report.rows.find(r=>r.postId===b)!.exposed,false,'exposure is for the same post only');
 assert.equal(rowC.briefing,false);assert.equal(rowC.cited,false);
 const detail=citationDetail(db,owner,rowA.id);
 assert.deepEqual(detail.briefingDetail!.references.map(r=>[r.mine,r.samePost]),[[false,false],[true,false]]);
 assert.deepEqual(detail.briefingDetail!.media.map(m=>[m.mine,m.samePost]),[[true,true]]);
 assert.equal(detail.viewedAt,null,'reading the detail does not record a view');
 assert.equal(tutorial(db,owner,NOW).steps.find(s=>s.key==='ai_picks')!.lockedReason,'AI 인용 현황에서 글 하나의 상세를 열어 확인해주세요.');
 const first=markCitationViewed(db,owner,rowA.id,NOW+3000);
 assert.equal(markCitationViewed(db,owner,rowA.id,NOW+9000).viewedAt,first.viewedAt,'first view time is kept');
 assert.equal(tutorial(db,owner,NOW).steps.find(s=>s.key==='ai_picks')!.eligible,true);
 assert.equal(finishTutorial(db,owner,{step:'ai_picks'},NOW).awarded,30);
 assert.equal(finishTutorial(db,owner,{step:'ai_picks'},NOW).awarded,0);
});

test('a transient provider failure requeues with backoff and the retry skips posts already saved',async t=>{
 const {db,owner,blog,post}=await fixture(t);
 for(let i=1;i<=4;i++)post(String(i),`글 ${i}`,[`키워드 ${i}`]);
 const run=enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW);
 let calls=0;
 const flaky:CitationProvider=async keyword=>{calls++;if(calls===3)throw new CitationError('CITATION_PROVIDER_BUSY','바쁨',true);return evidence({links:[{link:'https://example.com',section:'web_results',position:1}]});void keyword;};
 await runCitationOnce(db,'w1',flaky,()=>NOW);
 let state=getCitationRun(db,owner,run.id);
 assert.equal(state.state,'queued');assert.equal(state.errorCode,'CITATION_PROVIDER_BUSY');assert.equal(state.checked,2);
 assert.equal(await runCitationOnce(db,'w1',flaky,()=>NOW+1000),null,'backoff delays the retry');
 const asked:string[]=[];
 await runCitationOnce(db,'w2',async k=>{asked.push(k);return evidence();},()=>NOW+61_000);
 state=getCitationRun(db,owner,run.id);
 assert.equal(state.state,'succeeded');assert.equal(state.attempt,2);assert.equal(state.checked,4);assert.equal(state.errorCode,null);
 assert.deepEqual(asked,['키워드 3','키워드 4'],'only the remaining posts are searched again');
 assert.equal(count(db,'SELECT count(*) AS n FROM citation_results WHERE run_id=?',run.id),4);
});

test('terminal failures, query-level errors, configuration removal and cancellation',async t=>{
 const {db,owner,blog,post}=await fixture(t);
 post('1','글 하나',['첫째 키워드']);post('2','글 둘',['둘째 키워드']);
 const auth=enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW);
 await runCitationOnce(db,'w1',async()=>{throw new CitationError('CITATION_PROVIDER_AUTH','인증 실패',false);},()=>NOW);
 assert.equal(getCitationRun(db,owner,auth.id).state,'failed');
 let view=citationOverview(db,owner,{config,now:NOW});
 assert.equal(view.report,null);assert.equal(view.lastRun!.errorCode,'CITATION_PROVIDER_AUTH');
 const mixed=enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW);
 await runCitationOnce(db,'w1',async k=>{if(k==='둘째 키워드')throw new CitationError('CITATION_QUERY_FAILED','이 키워드 실패',false,'query');return evidence();},()=>NOW);
 assert.equal(getCitationRun(db,owner,mixed.id).state,'succeeded');
 view=citationOverview(db,owner,{config,now:NOW});
 assert.equal(view.report!.errors,1);assert.equal(view.report!.checked,1);
 assert.equal(view.report!.rows.find(r=>r.keyword==='둘째 키워드')!.status,'error');
 assert.equal(citationDetail(db,owner,view.report!.rows.find(r=>r.keyword==='둘째 키워드')!.id).error!.code,'CITATION_QUERY_FAILED');
 const extra=enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW);
 await runCitationOnce(db,'w1',async()=>evidence(),()=>NOW);
 assert.throws(()=>enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW),{status:429,code:'CITATION_QUOTA_EXCEEDED'},'the failed run that checked nothing is not counted');
 const tomorrow=NOW+86_400_000;
 const removed=enqueueCitation(db,owner,{blogId:blog},{source:'member',config},tomorrow);
 await runCitationOnce(db,'w1',null,()=>tomorrow);
 assert.equal(getCitationRun(db,owner,removed.id).errorCode,'CITATION_NOT_CONFIGURED');
 const canceled=enqueueCitation(db,owner,{blogId:blog},{source:'member',config},tomorrow);
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const running=runCitationOnce(db,'w1',async()=>{await gate;return evidence();},()=>tomorrow);
 await new Promise(r=>setImmediate(r));
 assert.equal(cancelCitationRun(db,owner,canceled.id,tomorrow).cancelRequested,true);
 release();await running;
 const after=getCitationRun(db,owner,canceled.id);
 assert.equal(after.state,'canceled');assert.equal(after.checked,1,'stops before the next post');
 assert.equal(citationOverview(db,owner,{config,now:tomorrow}).report!.runId,extra.id,'canceled partial results are not shown');
 assert.throws(()=>cancelCitationRun(db,owner,canceled.id,tomorrow),{status:409});
});

test('a worker whose lease expired cannot write results after another worker recovered the run',async t=>{
 const {db,owner,blog,post}=await fixture(t);
 post('1','글',['하나']);
 const run=enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW);
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 let clock=NOW;
 const stale=runCitationOnce(db,'w1',async()=>{await gate;return evidence();},()=>clock);
 await new Promise(r=>setImmediate(r));
 clock=NOW+CITATION_LEASE_MS+1;
 await runCitationOnce(db,'w2',async()=>evidence({links:[{link:'https://blog.naver.com/cite_blog/1',section:'web_results',position:1}]}),()=>clock);
 release();await stale;
 assert.equal(getCitationRun(db,owner,run.id).state,'succeeded');
 assert.equal(count(db,'SELECT count(*) AS n FROM citation_results WHERE run_id=?',run.id),1);
 assert.equal(count(db,'SELECT exposed AS n FROM citation_results WHERE run_id=?',run.id),1,'the recovering worker result is kept');
});

test('enqueue validation, ownership isolation and member keyword overrides',async t=>{
 const {db,owner,other,blog,post}=await fixture(t);
 assert.throws(()=>enqueueCitation(db,owner,{blogId:blog},{source:'member',config:null},NOW),{status:503,code:'CITATION_NOT_CONFIGURED'});
 assert.throws(()=>enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW),{status:409,code:'CITATION_POSTS_REQUIRED'});
 assert.throws(()=>enqueueCitation(db,other,{blogId:blog},{source:'member',config},NOW),{status:404});
 assert.throws(()=>enqueueCitation(db,owner,{blogId:blog,ownerId:other},{source:'member',config},NOW),{name:'ZodError'});
 const p=post('1','부산 해운대 맛집 추천',[]);
 assert.throws(()=>setPostKeyword(db,other,p,{keyword:'남의 글',version:0}),{status:404});
 assert.throws(()=>setPostKeyword(db,owner,p,{keyword:'x',version:0}),{name:'ZodError'});
 const set=setPostKeyword(db,owner,p,{keyword:'  해운대   맛집 ',version:0},NOW);
 assert.deepEqual(set,{keyword:'해운대 맛집',source:'member',version:1});
 assert.throws(()=>setPostKeyword(db,owner,p,{keyword:'해운대',version:0}),{status:409,code:'VERSION_CONFLICT'});
 assert.equal(setPostKeyword(db,owner,p,{keyword:'해운대 횟집',version:1}).version,2);
 const run=enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW);
 const asked:string[]=[];
 await runCitationOnce(db,'w1',async k=>{asked.push(k);return evidence();},()=>NOW);
 assert.deepEqual(asked,['해운대 횟집']);
 const result=citationOverview(db,owner,{config,now:NOW}).report!.rows[0];
 assert.equal(result.keywordSource,'member');assert.equal(result.keywordVersion,2);
 for(const call of [()=>getCitationRun(db,other,run.id),()=>citationDetail(db,other,result.id),()=>markCitationViewed(db,other,result.id),()=>cancelCitationRun(db,other,run.id)])assert.throws(call,{status:404});
 assert.equal(citationOverview(db,other,{config,now:NOW}).blog,null);
 assert.throws(()=>citationOverview(db,other,{blogId:blog,config,now:NOW}),{status:404});
 assert.throws(()=>removePostKeyword(db,owner,p,{version:1}),{status:409});
 assert.deepEqual(removePostKeyword(db,owner,p,{version:2}),{keyword:'부산 해운대 맛집 추천',source:'title',version:0});
 assert.equal(DAILY_CITATION_LIMIT,2);
});

test('scan completion schedules one citation check per scan job when configured',async t=>{
 const {db,owner,blog}=await fixture(t);
 const env={provider:process.env.NAEO_CITATION_PROVIDER,key:process.env.NAEO_SERPAPI_KEY};
 t.after(()=>{for(const [k,v] of [['NAEO_CITATION_PROVIDER',env.provider],['NAEO_SERPAPI_KEY',env.key]] as const){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const rss=`<?xml version="1.0"?><rss><channel><title>인용 블로그</title><item><title>제주 여행 코스 정리</title><link>https://blog.naver.com/cite_blog/11</link><tag>제주 여행,코스</tag><pubDate>Thu, 15 Oct 2026 10:00:00 +0900</pubDate></item></channel></rss>`;
 const handler=scanHandler(db,async()=>new Response(rss,{status:200}),()=>NOW);
 const ctx={progress:async()=>{},canceled:()=>false};
 delete process.env.NAEO_CITATION_PROVIDER;
 enqueueScan(db,owner,{blogId:blog},NOW);let job=claimNextScan(db,'w',NOW)!;
 await handler(job,ctx);
 assert.equal(count(db,'SELECT count(*) AS n FROM citation_runs'),0);
 const report=()=>JSON.parse((db.prepare('SELECT report_json FROM scan_results ORDER BY rowid DESC LIMIT 1').get() as {report_json:string}).report_json);
 assert.deepEqual(report().aiCitation,{status:'not_configured'});
 db.prepare("UPDATE scan_jobs SET state='succeeded',lease_owner=NULL,lease_until=NULL").run();
 process.env.NAEO_CITATION_PROVIDER='serpapi';process.env.NAEO_SERPAPI_KEY='z'.repeat(40);
 enqueueScan(db,owner,{blogId:blog},NOW);job=claimNextScan(db,'w',NOW)!;
 await handler(job,ctx);
 db.prepare('DELETE FROM scan_results WHERE job_id=?').run(job.id);
 await handler(job,ctx);
 assert.equal(count(db,"SELECT count(*) AS n FROM citation_runs WHERE source='scan'"),1,'a re-run of the same scan job does not schedule twice');
 assert.equal(report().aiCitation.status,'scheduled');
 db.prepare("UPDATE scan_jobs SET state='succeeded',lease_owner=NULL,lease_until=NULL").run();
 enqueueScan(db,owner,{blogId:blog},NOW);job=claimNextScan(db,'w',NOW)!;
 await handler(job,ctx);
 assert.deepEqual(report().aiCitation,{status:'skipped',reason:'CITATION_IN_PROGRESS'});
});

test('retention keeps five finished runs per blog; export and account deletion cover citation data',async t=>{
 const {db,owner,blog,post}=await fixture(t);
 const p=post('1','글',['하나']);
 for(let day=0;day<7;day++){const at=NOW+day*86_400_000;enqueueCitation(db,owner,{blogId:blog},{source:'member',config},at);await runCitationOnce(db,'w',async()=>evidence(),()=>at);}
 setPostKeyword(db,owner,p,{keyword:'직접 지정',version:0},NOW);
 assert.equal(count(db,'SELECT count(*) AS n FROM citation_runs'),7);
 assert.equal(runRetention(db,NOW+8*86_400_000).citations,2);
 assert.equal(count(db,'SELECT count(*) AS n FROM citation_runs'),5);
 assert.equal(count(db,'SELECT count(*) AS n FROM citation_results'),5);
 for(const name of ['citation_runs','citation_results','post_keywords']){const d=datasets.find(x=>x.name===name)!;assert.ok((db.prepare(d.sql).all(owner) as unknown[]).length>0,name);}
 db.prepare('DELETE FROM users WHERE id=?').run(owner);
 for(const table of ['citation_runs','citation_results','post_keywords'])assert.equal(count(db,`SELECT count(*) AS n FROM ${table}`),0,table);
});

test('daily quota ignores runs that failed or were canceled before checking any post',async t=>{
 const {db,owner,blog,post}=await fixture(t);
 post('1','글',['첫째 키워드']);
 for(let i=0;i<3;i++){const r=enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW);await runCitationOnce(db,'w',async()=>{throw new CitationError('CITATION_PROVIDER_AUTH','인증 실패',false);},()=>NOW);assert.equal(getCitationRun(db,owner,r.id).state,'failed');}
 const queued=enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW);
 cancelCitationRun(db,owner,queued.id,NOW);
 assert.equal(citationOverview(db,owner,{config,now:NOW}).remaining,DAILY_CITATION_LIMIT);
 for(let i=0;i<DAILY_CITATION_LIMIT;i++){enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW);await runCitationOnce(db,'w',async()=>evidence(),()=>NOW);}
 assert.throws(()=>enqueueCitation(db,owner,{blogId:blog},{source:'member',config},NOW),{status:429});
});

test('oversized briefings are trimmed to fit storage instead of failing the run',()=>{
 const huge={markdown:'가'.repeat(12000),questions:['q'],references:Array.from({length:20},(_,i)=>({index:i+1,title:'t'.repeat(200),link:`https://example.com/${'p'.repeat(980)}${i}`,source:'s'.repeat(100),snippet:'n'.repeat(300)})),
  media:Array.from({length:20},(_,i)=>({position:i+1,title:'t'.repeat(200),link:`https://example.com/${'m'.repeat(980)}${i}`,thumbnail:`https://example.com/${'h'.repeat(980)}`,platform:'p'.repeat(100)}))};
 const json=fitEvidence({briefing:huge,exposure:null,searches:2});
 assert.ok(json.length<=110_000);
 const kept=JSON.parse(json);
 assert.ok(kept.briefing.references.length>0,'sources are preserved when possible');
 assert.equal(fitEvidence({briefing:null,exposure:null,searches:1}),'{"briefing":null,"exposure":null,"searches":1}');
});
