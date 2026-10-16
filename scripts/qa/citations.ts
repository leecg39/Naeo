/** Isolated production HTTP + worker verification of AI citation checks against a loopback SerpApi double. No external search. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {migrations} from '../../src/server/migrations';
import {openDatabase} from '../../src/server/database';

const freePort=async()=>{const probe=tcpServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));return port;};
async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-citations-http-')),children:ChildProcess[]=[],apiKey=randomBytes(32).toString('hex'),queries:string[]=[];let badKey=0;
 const provider=createServer((q,r)=>{
  const u=new URL(q.url!,'http://local');
  if(u.pathname!=='/search.json'||u.searchParams.get('api_key')!==apiKey){badKey++;r.writeHead(401,{'Content-Type':'application/json'});r.end('{"error":"Invalid API key."}');return;}
  const engine=u.searchParams.get('engine'),query=u.searchParams.get('query')??'';queries.push(`${engine}:${query||u.searchParams.get('page_token')}`);
  r.writeHead(200,{'Content-Type':'application/json'});
  if(engine==='naver')return r.end(JSON.stringify({
   blog_results:[{link:'https://blog.naver.com/qa_cite/101'},{link:'https://blog.naver.com/someone/5'}],
   ai_briefing:query.includes('제주')?{page_token:'qa_token_jeju'}:query.includes('부산')?{markdown:'부산 요약 [1]',references:[{index:1,title:'다른 블로그',link:'https://blog.naver.com/someone/5'}]}:undefined}));
  r.end(JSON.stringify({markdown:'제주 여행 요약 [1][2]',references:[{index:1,title:'백과',link:'https://example.com/jeju'},{index:2,title:'QA 글',link:'https://m.blog.naver.com/qa_cite/101'}],media:[{position:4,title:'QA 사진',link:'https://blog.naver.com/PostView.naver?blogId=qa_cite&logNo=102'}],related_questions:[{question:'제주 3박 4일 코스는?'}]}));
 });
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));const stub=(provider.address() as {port:number}).port;
 const port=await freePort(),origin=`http://127.0.0.1:${port}`,dbPath=join(temp,'db.sqlite');
 const env={...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads'),NAEO_WORKER_IDLE_MS:'100',NAEO_CITATION_PROVIDER:'serpapi',NAEO_SERPAPI_KEY:apiKey,NAEO_SERPAPI_BASE:`http://127.0.0.1:${stub}`};
 const launch=(args:string[])=>{const p=spawn(process.execPath,args,{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});p.stdout!.on('data',()=>{});p.stderr!.on('data',()=>{});children.push(p);return p;};
 const req=(path:string,method='GET',data?:unknown,cookie?:string)=>fetch(origin+path,{method,headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const json=async(r:Response)=>(await r.json()).data;
 const until=async<T>(check:()=>Promise<T|false>)=>{const end=Date.now()+45000;while(Date.now()<end){const v=await check();if(v!==false)return v;await delay(150);}throw new Error('Acceptance timeout');};
 let result:Record<string,unknown>|undefined;
 try{
  launch(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)]);
  await until(async()=>{try{return (await req('/api/health')).ok||false;}catch{return false;}});
  const health=await json(await req('/api/health'));assert.equal(health.schemaVersion,migrations.at(-1)!.version);
  launch(['--import','tsx','scripts/worker.ts']);
  const signup=async(email:string)=>{const r=await req('/api/auth/register','POST',{email,password:randomBytes(24).toString('base64url'),nickname:'인용 QA',termsAccepted:true});assert.equal(r.status,201);return r.headers.get('set-cookie')!.split(';')[0];};
  const a=await signup('citation-a@example.test'),b=await signup('citation-b@example.test');
  const blog=await json(await req('/api/blogs','POST',{naverId:'qa_cite',title:'인용 QA 블로그'},a));
  const db=openDatabase(dbPath);
  const now=Date.now(),post=(logNo:string,title:string,tag:string,category:string)=>db.prepare('INSERT INTO blog_posts(id,blog_id,external_id,url,title,excerpt,category,tags_json,published_at,collected_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),blog.id,logNo,`https://blog.naver.com/qa_cite/${logNo}`,title,'',category,JSON.stringify(tag?[tag]:[]),now-(200-Number(logNo))*3600_000,now);
  post('101','제주 여행 3박 4일 코스','제주 여행','여행');post('102','제주 여행 맛집 정리','제주 여행','여행');post('103','부산 해운대 산책','부산 산책','일상');post('104','[공지] 서울 카페 투어 후기','','');
  db.close();
  const before=await(await req('/dashboard/ai-picks','GET',undefined,a)).text();
  assert.ok(before.includes('인용 확인 시작'));assert.ok(!before.includes(apiKey));assert.ok(!before.includes('병역특례'));
  const created=await req('/api/citations/runs','POST',{blogId:blog.id,idempotencyKey:'qa-1'},a);assert.equal(created.status,201);const run=await json(created);
  const done=await until(async()=>{const s=await json(await req(`/api/citations/runs/${run.id}`,'GET',undefined,a));return ['succeeded','failed','canceled'].includes(s.state)?s:false;});
  assert.equal(done.state,'succeeded');assert.equal(done.checked,4);
  assert.deepEqual(queries,['naver:서울 카페 투어 후기','naver:부산 산책','naver:제주 여행','naver_ai_overview:qa_token_jeju'],'newest first, one search per distinct keyword, token follow-up');
  const view=await json(await req('/api/citations','GET',undefined,a));
  assert.deepEqual({total:view.report.total,cited:view.report.cited,exposed:view.report.exposed,briefing:view.report.briefing,text:view.report.textCited,image:view.report.imageCited},{total:4,cited:2,exposed:1,briefing:3,text:2,image:2});
  const jeju=view.report.rows.find((r:{postId:string;url:string})=>r.url.endsWith('/101'));
  assert.equal(jeju.exposed,true);assert.equal(jeju.textRank,2);assert.equal(jeju.imageRank,4);
  const html=await(await req('/dashboard/ai-picks','GET',undefined,a)).text();
  for(const text of ['제주 여행 3박 4일 코스','본문 2위 · 이미지 4위','미추천','인용 다시 확인','AI 추천됨 2'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes(apiKey));
  const dashboard=await(await req('/dashboard','GET',undefined,a)).text();assert.ok(dashboard.includes('AI 추천 2/4'));
  assert.equal((await req(`/api/citations/results/${jeju.id}`,'GET',undefined,b)).status,404);
  const detail=await json(await req(`/api/citations/results/${jeju.id}`,'GET',undefined,a));
  assert.equal(detail.briefingDetail.references[1].samePost,true);assert.equal(detail.briefingDetail.media[0].mine,true);assert.deepEqual(detail.briefingDetail.questions,['제주 3박 4일 코스는?']);
  assert.equal((await req('/api/tutorial/finish','POST',{step:'ai_picks'},a)).status,409);
  assert.equal((await req(`/api/citations/results/${jeju.id}/viewed`,'POST',undefined,a)).status,200);
  assert.equal((await json(await req('/api/tutorial/finish','POST',{step:'ai_picks'},a))).awarded,30);
  const cafe=view.report.rows.find((r:{url:string})=>r.url.endsWith('/104'));
  assert.equal(cafe.keywordSource,'title');
  assert.equal((await req(`/api/citations/keywords/${cafe.postId}`,'PUT',{keyword:'성수 카페',version:0},a)).status,200);
  const second=await json(await req('/api/citations/runs','POST',{blogId:blog.id},a));
  await until(async()=>{const s=await json(await req(`/api/citations/runs/${second.id}`,'GET',undefined,a));return s.state==='succeeded'||false;});
  assert.ok(queries.includes('naver:성수 카페'),'the member keyword is used on the next run');
  assert.equal((await req('/api/citations/runs','POST',{blogId:blog.id},a)).status,429);
  assert.equal((await req('/api/citations/runs','POST',{blogId:blog.id},b)).status,404);
  assert.equal(badKey,0);
  result={verifiedAt:new Date().toISOString(),schemaVersion:health.schemaVersion,providerRequests:queries.length,checks:['Production Next + worker with loopback SerpApi double; key never rendered','Newest posts first, duplicate keywords searched once, page_token follow-up for AI briefing','Text/image citation ranks and same-post integrated search exposure stored and summarized','AI picks and dashboard SSR show the member results; captured account rows absent','Detail isolation; viewing records the tutorial condition; 30P claimed once','Member keyword override used on the next run; daily limit 2 returns 429'],externalSearchPerformed:false,realProviderVerified:false,temporaryDataRemoved:true};
 }finally{
  for(const p of children){if(p.exitCode!==null||p.signalCode!==null)continue;const exited=new Promise<void>(r=>p.once('exit',()=>r()));p.kill('SIGTERM');const timer=setTimeout(()=>p.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  await new Promise<void>(r=>{provider.close(()=>r());provider.closeAllConnections();});rmSync(temp,{recursive:true,force:true});
 }
 writeFileSync(resolve(process.argv[2]||'docs/fullstack/evidence/citations-runtime.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e instanceof Error?e.stack:e)+'\n');process.exitCode=1;});
