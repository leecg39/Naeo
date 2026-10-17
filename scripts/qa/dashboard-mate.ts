/** Isolated production HTTP check. --serve keeps the fixture available for Ego browser verification. */
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
import {diagnoseBlog} from '../../src/server/mate/mate';

const DAY=86400000,now=Date.now();
function rss(id:string,n:number,at:number){return `<rss><channel><title>시각화 검증 블로그</title>${Array.from({length:n},(_,i)=>`<item><title>제주 여행을 준비하는 구체적인 코스 안내 ${i+1}</title><link>https://blog.naver.com/${id}/${200000+i}</link><category>여행</category><tag>제주,여행,코스</tag><pubDate>${new Date(at-i*DAY).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;}
async function main(){
 const serve=process.argv.includes('--serve'),temp=mkdtempSync(join(tmpdir(),'naeo-dashboard-mate-'));
 const output=resolve('docs/fullstack/evidence/dashboard-mate-2026-10-17');mkdirSync(output,{recursive:true});
 const dbPath=join(temp,'db.sqlite'),origin='http://localhost:3107';let child:ChildProcess|undefined;
 const stub=createServer((req,res)=>{res.writeHead(200,{'content-type':'application/rss+xml'});res.end(rss(req.url?.slice(1).replace(/\.xml$/,'')??'visual_blog',9,now));});
 try{
  await new Promise<void>(r=>stub.listen(0,'127.0.0.1',r));
  const stubPort=(stub.address() as {port:number}).port;
  const db=openDatabase(dbPath);let token:string;
  try{
   const registered=await register(db,{email:'visualization@example.test',password:randomBytes(32).toString('base64url'),nickname:'진단 시각화 검증',termsAccepted:true});token=registered.session.token;
   createBlog(db,registered.user.id,{naverId:'empty_primary',title:'진단 전 대표 블로그',isPrimary:true});
   for(const [id,n,offset] of [['visual_blog',2,7],['visual_blog',5,2],['second_blog',1,1]] as const){
    await diagnoseBlog(db,{blog:id,userId:registered.user.id,peer:`fixture-${offset}`},async()=>new Response(rss(id,n,now-offset*DAY)),now-offset*DAY);
   }
  }finally{db.close();}
  writeFileSync(join(temp,'session.json'),JSON.stringify({token,origin}),{mode:0o600});
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3107'],{env:{...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads'),NAEO_RSS_BASE:`http://127.0.0.1:${stubPort}`,NAEO_CITATION_PROVIDER:'',NAEO_SERPAPI_KEY:''},stdio:'ignore'});
  const req=(path:string,method='GET',body?:unknown)=>fetch(origin+path,{method,headers:{Origin:origin,Cookie:`naeo_session=${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('QA Next server exited');try{if((await req('/api/health')).ok){ready=true;break;}}catch{/* startup */}await delay(100);}assert.ok(ready);
  const response=await req('/api/mate/diagnose','POST',{blog:'visual_blog'});assert.equal(response.status,201);const report=(await response.json()).data;
  assert.equal(report.postCount,9);assert.equal(report.saved,true);
  const page=await req('/dashboard?blog=visual_blog');assert.equal(page.status,200);const html=await page.text();
  for(const content of ['visual_blog','종합 점수','진단 점수','발행 빈도','최근성','제목 구체성','태그 활용','주제 일관성','무료 진단'])assert.ok(html.includes(content),`${content} in server-rendered page`);
  const history=await req('/dashboard/mate');assert.ok((await history.text()).includes('/dashboard?blog=visual_blog'));
  const proof={verifiedAt:new Date().toISOString(),score:report.report.score,postCount:report.postCount,checks:['Actual production POST /api/mate/diagnose with loopback RSS','Saved report renders on /dashboard?blog=visual_blog with five criteria','Existing diagnoses are available without scans','History links to the corresponding dashboard'],browserVerified:false};
  writeFileSync(join(output,'http.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({temp,origin,score:proof.score,ready:true}));
  if(serve)await new Promise<void>(r=>{process.once('SIGINT',r);process.once('SIGTERM',r);});
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const stopping=child,exited=new Promise<void>(r=>stopping.once('exit',()=>r()));stopping.kill('SIGTERM');const timer=setTimeout(()=>stopping.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  await new Promise<void>(r=>stub.close(()=>r()));rmSync(temp,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
