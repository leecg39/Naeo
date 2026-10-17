/** Production HTTP + optional Ego fixture. All accounts, metrics and RSS data are isolated. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createPlan} from '../../src/server/billing/plans';
import {startTrial} from '../../src/server/billing/subscriptions';
import {createBlog} from '../../src/server/blogs';
import {collectBlog} from '../../src/server/collect/rss';
import {createKeyword,addKeywordMetric} from '../../src/server/keywords/admin-keywords';

async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-recommendation-feed-')),dbPath=join(temp,'db.sqlite'),origin='http://localhost:3107';
 const output=resolve('docs/fullstack/evidence/recommendations-rea-2026-10-17');mkdirSync(output,{recursive:true});
 let child:ChildProcess|undefined,providerRequests=0;
 const stub=createServer((req,res)=>{
  const url=new URL(req.url??'/','http://localhost');providerRequests++;
  const value=url.pathname==='/keywordstool'?{keywordList:(url.searchParams.get('hintKeywords')??'').split(',').map((phrase,i)=>({relKeyword:phrase,monthlyPcQcCnt:400+i*100,monthlyMobileQcCnt:1600,compIdx:'low'}))}:url.pathname.includes('news')?{total:1,items:[{title:'QA news',link:'https://example.com/news',originallink:'https://example.com/news',pubDate:new Date().toUTCString()}]}:{total:400,items:[{title:'QA competitor blog',link:'https://blog.naver.com/reference_blog/100',bloggername:'Reference blog',bloggerlink:'https://blog.naver.com/reference_blog',postdate:'20261017'}]};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
 });
 try{
  await new Promise<void>(r=>stub.listen(0,'127.0.0.1',r));const port=(stub.address() as {port:number}).port;
  const db=openDatabase(dbPath);let token:string;
  try{
   const owner=await register(db,{email:'keyword-qa@example.test',password:randomBytes(32).toString('base64url'),nickname:'키워드 검증',termsAccepted:true});token=owner.session.token;
   const admin=await register(db,{email:'keyword-admin@example.test',password:randomBytes(32).toString('base64url'),nickname:'관리자',termsAccepted:true});db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.user.id);
   const now=Date.now();
   for(let i=0;i<53;i++){
    const k=createKeyword(db,admin.user.id,{phrase:`제주 여행 추천 ${String(i+1).padStart(2,'0')}`,category:i%2?'여행':'일상'},now-i*86400000);
    if(i!==0)addKeywordMetric(db,admin.user.id,k.id,{pcVolume:100+i*20,mobileVolume:600+i*30,documentCount:i%7===1?100:4000+i*50},now-86400000);
    if(i!==0)addKeywordMetric(db,admin.user.id,k.id,{pcVolume:200+i*30,mobileVolume:800+i*50,documentCount:i%7===1?100:4000+i*50},now);
   }
   const blog=createBlog(db,owner.user.id,{naverId:'keyword_blog',title:'내 여행 기록',isPrimary:true});
   createPlan(db,admin.user.id,{code:'starter',name:'Starter',price:9900,monthlyTokens:750,trialDays:7});
   startTrial(db,owner.user.id,{planCode:'starter'},now);
   await collectBlog(db,blog.id,async()=>new Response(`<rss><channel><title>내 여행 기록</title>${['제주 산책길 추천 코스','서귀포 여행 맛집 지도','제주 해변 여행 준비물'].map((title,i)=>`<item><title>${title}</title><link>https://blog.naver.com/keyword_blog/${10000+i}</link><category>여행</category><tag>제주 여행,제주산책,제주맛집,여행준비</tag><pubDate>${new Date(now-i*86400000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`),now);
  }finally{db.close();}
  writeFileSync(join(temp,'session.json'),JSON.stringify({token,origin}),{mode:0o600});
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3107'],{env:{...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads'),NAEO_SEARCHAD_API_KEY:'local-test-keyword-key',NAEO_SEARCHAD_SECRET:'local-test-secret',NAEO_SEARCHAD_CUSTOMER_ID:'12345',NAEO_SEARCHAD_BASE:`http://127.0.0.1:${port}`,NAEO_NAVER_CLIENT_ID:'local-test-client-id',NAEO_NAVER_CLIENT_SECRET:'local-test-secret',NAEO_NAVER_SEARCH_BASE:`http://127.0.0.1:${port}`},stdio:'ignore'});
  const req=(path:string,method='GET',data?:unknown)=>fetch(origin+path,{method,headers:{Origin:origin,Cookie:`naeo_session=${token}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('QA Next exited');try{if((await req('/api/health')).ok){ready=true;break;}}catch{/* startup */}await delay(100);}assert.ok(ready);
  const ssr=await req('/dashboard/recommendations');assert.equal(ssr.status,200);
  const feed=await (await req('/api/recommendations/feed')).json();assert.ok(feed.data.summary.total>0);assert.ok(feed.data.goldenItems.length>0);
  const item=feed.data.items[0];assert.ok(item.sourcePost);
  const path=`/api/recommendations/feed/${item.id}`;
  const refresh=await req('/api/recommendations/refresh','POST',{blogId:feed.data.selectedBlogId});assert.equal(refresh.status,200);
  const refreshed=(await refresh.json()).data;
  const current=[...refreshed.items,...refreshed.goldenItems].find((r:{id:string})=>r.id===item.id);assert.ok(current);
  const detail=await req(`${path}/competition`,'POST',{version:current.version});assert.equal(detail.status,200);
  const enriched=(await detail.json()).data;assert.equal(enriched.competition.blogs.length,1);assert.equal(enriched.competition.news.length,1);
  const mark=await req(path,'PATCH',{version:enriched.version,written:true,saved:true});assert.equal(mark.status,200);const saved=(await mark.json()).data;
  const written=(await (await req('/api/recommendations/feed?filter=written')).json()).data;assert.ok(written.items.some((r:{id:string})=>r.id===item.id));
  const undo=await req(path,'PATCH',{version:saved.version,written:false});assert.equal(undo.status,200);
  writeFileSync(join(output,'http.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:['SSR source-backed discovery bootstrap','Authenticated feed and separate golden section','Provider enrichment after local bootstrap','Actual HTTP related SearchAd and blog/news adapters on loopback','Written and personal-library save persist','Written filter and undo'],summary:refreshed.summary,providerRequests,externalProviderVerified:false},null,2)+'\n');
  console.log(JSON.stringify({temp,origin,ready:true}));
  if(process.argv.includes('--serve'))await new Promise<void>(r=>{process.once('SIGINT',r);process.once('SIGTERM',r);});
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const stopping=child,exited=new Promise<void>(r=>stopping.once('exit',()=>r()));stopping.kill('SIGTERM');const timer=setTimeout(()=>stopping.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  await new Promise<void>(r=>stub.close(()=>r()));rmSync(temp,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
