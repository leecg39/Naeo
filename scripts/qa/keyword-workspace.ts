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
import {createBlog} from '../../src/server/blogs';
import {collectBlog} from '../../src/server/collect/rss';
import {createKeyword,addKeywordMetric} from '../../src/server/keywords/admin-keywords';

async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-keyword-workspace-')),dbPath=join(temp,'db.sqlite'),origin='http://localhost:3107';
 const output=resolve('docs/fullstack/evidence/keyword-workspace-2026-10-17');mkdirSync(output,{recursive:true});
 let child:ChildProcess|undefined,providerRequests=0;
 const stub=createServer((req,res)=>{
  const url=new URL(req.url??'/','http://localhost');providerRequests++;
  const value=url.pathname==='/keywordstool'?{keywordList:[{relKeyword:url.searchParams.get('hintKeywords'),monthlyPcQcCnt:400,monthlyMobileQcCnt:1600,compIdx:'낮음'}]}:{total:400,items:[]};
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
    if(i!==0)addKeywordMetric(db,admin.user.id,k.id,{pcVolume:200+i*30,mobileVolume:800+i*50,documentCount:i===52?100:4000+i*50},now);
   }
   const blog=createBlog(db,owner.user.id,{naverId:'keyword_blog',title:'내 여행 기록',isPrimary:true});
   await collectBlog(db,blog.id,async()=>new Response(`<rss><channel><title>내 여행 기록</title>${['제주 산책길 추천 코스','서귀포 여행 맛집 지도','제주 해변 여행 준비물'].map((title,i)=>`<item><title>${title}</title><link>https://blog.naver.com/keyword_blog/${10000+i}</link><category>여행</category><tag>제주산책,제주맛집,여행준비</tag><pubDate>${new Date(now-i*86400000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`),now);
  }finally{db.close();}
  writeFileSync(join(temp,'session.json'),JSON.stringify({token,origin}),{mode:0o600});
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3107'],{env:{...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads'),NAEO_SEARCHAD_API_KEY:'local-test-keyword-key',NAEO_SEARCHAD_SECRET:'local-test-secret',NAEO_SEARCHAD_CUSTOMER_ID:'12345',NAEO_SEARCHAD_BASE:`http://127.0.0.1:${port}`,NAEO_NAVER_CLIENT_ID:'local-test-client-id',NAEO_NAVER_CLIENT_SECRET:'local-test-secret',NAEO_NAVER_SEARCH_BASE:`http://127.0.0.1:${port}`},stdio:'ignore'});
  const req=(path:string,method='GET',data?:unknown)=>fetch(origin+path,{method,headers:{Origin:origin,Cookie:`naeo_session=${token}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('QA Next exited');try{if((await req('/api/health')).ok){ready=true;break;}}catch{/* startup */}await delay(100);}assert.ok(ready);
  const result=await (await req('/api/recommendations?filter=golden')).json();assert.equal(result.data[0].phrase,'제주 여행 추천 53');
  const created=await req('/api/recommendations','POST',{phrase:'HTTP 검증 키워드',category:'검증'});assert.equal(created.status,201);const k=(await created.json()).data;
  const metric=await req(`/api/recommendations/${k.id}/metrics`,'POST',{version:k.version});assert.equal(metric.status,200);const measured=(await metric.json()).data;assert.equal(measured.total,2000);assert.equal(measured.saturation,.2);assert.equal(measured.golden,true);
  const mark=await req(`/api/recommendations/${k.id}`,'PATCH',{favorite:true,written:true,note:'HTTP 보존 검증',version:measured.version});assert.equal(mark.status,200);const saved=(await mark.json()).data;
  assert.equal((await (await req('/api/recommendations?filter=saved')).json()).data[0].written,true);
  const ssr=await req('/dashboard/recommendations?q=HTTP');assert.equal(ssr.status,200);assert.ok((await ssr.text()).includes('HTTP 검증 키워드'));
  const suggestions=await (await req('/api/recommendations/suggestions')).json();assert.ok(suggestions.data.some((s:{phrase:string})=>s.phrase==='제주산책'));
  assert.equal((await req(`/api/recommendations/${k.id}`,'DELETE',{version:saved.version})).status,200);
  writeFileSync(join(output,'http.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:['SSR query and private keyword API','53 catalog items, golden filter reaches last item before pagination','Actual HTTP SearchAd and Naver Search adapters on loopback','Favorite and written simultaneously persisted','Owned RSS posts produce suggestions','Delete clears private keyword'],providerRequests,externalProviderVerified:false},null,2)+'\n');
  console.log(JSON.stringify({temp,origin,ready:true}));
  if(process.argv.includes('--serve'))await new Promise<void>(r=>{process.once('SIGINT',r);process.once('SIGTERM',r);});
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const stopping=child,exited=new Promise<void>(r=>stopping.once('exit',()=>r()));stopping.kill('SIGTERM');const timer=setTimeout(()=>stopping.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  await new Promise<void>(r=>stub.close(()=>r()));rmSync(temp,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
