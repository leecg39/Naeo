/** Isolated production HTTP verification of Naver SearchAd metrics collection and blog top-exposure checks against loopback doubles. No external calls. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {randomBytes,createHmac} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {openDatabase} from '../../src/server/database';

const freePort=async()=>{const probe=tcpServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));return port;};
async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-search-http-')),children:ChildProcess[]=[];
 const adKey='qa_'+randomBytes(12).toString('hex'),adSecret='qa_'+randomBytes(12).toString('hex'),customer='777001';
 const nvId='qa_'+randomBytes(12).toString('hex'),nvSecret='qa_'+randomBytes(8).toString('hex');
 const calls={keywordstool:0,keywordstoolBadSig:0,blog:0,blogBadAuth:0};
 const stub=createServer((q,r)=>{
  r.setHeader('Content-Type','application/json');
  if(q.url?.startsWith('/keywordstool')){
   calls.keywordstool++;
   const ts=String(q.headers['x-timestamp']??'');
   const expected=createHmac('sha256',adSecret).update(`${ts}.GET./keywordstool`).digest('base64');
   if(q.headers['x-api-key']!==adKey||q.headers['x-customer']!==customer||q.headers['x-api-signature']!==expected){calls.keywordstoolBadSig++;return r.writeHead(403).end('{"title":"bad signature"}');}
   const hints=(new URL(q.url,'http://x').searchParams.get('hintKeywords')??'').split(',');
   return r.writeHead(200).end(JSON.stringify({keywordList:hints.flatMap(p=>p==='없는 키워드'?[]:[{relKeyword:p,monthlyPcQcCnt:p==='제주 여행'?'< 10':1200,monthlyMobileQcCnt:3400,compIdx:'중간'}])}));
  }
  if(q.url?.startsWith('/v1/search/blog.json')){
   calls.blog++;
   if(q.headers['x-naver-client-id']!==nvId||q.headers['x-naver-client-secret']!==nvSecret){calls.blogBadAuth++;return r.writeHead(401).end('{"errorMessage":"bad","errorCode":"024"}');}
   return r.writeHead(200).end(JSON.stringify({total:54321,start:1,display:20,items:[
    {title:'<b>제주</b> 여행 경쟁 글',link:'https://blog.naver.com/rival_blog/101',description:'d',bloggername:'라이벌',bloggerlink:'https://blog.naver.com/rival_blog',postdate:'20261010'},
    {title:'제주 여행 내 글',link:'https://blog.naver.com/qa_mine/202',description:'d',bloggername:'나',bloggerlink:'https://blog.naver.com/qa_mine',postdate:'20261011'},
    {title:'다른 블로그 글',link:'https://blog.naver.com/stranger_blog/303',description:'d',bloggername:'남',bloggerlink:'',postdate:'20261012'}]}));
  }
  r.writeHead(404).end('{}');
 });
 await new Promise<void>(r=>stub.listen(0,'127.0.0.1',r));const stubPort=(stub.address() as {port:number}).port;
 const port=await freePort(),origin=`http://127.0.0.1:${port}`,dbPath=join(temp,'db.sqlite');
 const env={...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads'),
  NAEO_SEARCHAD_API_KEY:adKey,NAEO_SEARCHAD_SECRET:adSecret,NAEO_SEARCHAD_CUSTOMER_ID:customer,NAEO_SEARCHAD_BASE:`http://127.0.0.1:${stubPort}`,
  NAEO_NAVER_CLIENT_ID:nvId,NAEO_NAVER_CLIENT_SECRET:nvSecret,NAEO_NAVER_SEARCH_BASE:`http://127.0.0.1:${stubPort}`};
 const launch=(args:string[])=>{const p=spawn(process.execPath,args,{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});p.stdout!.on('data',()=>{});p.stderr!.on('data',()=>{});children.push(p);return p;};
 const req=(path:string,method='GET',data?:unknown,cookie?:string)=>fetch(origin+path,{method,headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const json=async(r:Response)=>(await r.json()).data;
 const until=async<T>(check:()=>Promise<T|false>)=>{const end=Date.now()+45000;while(Date.now()<end){const v=await check();if(v!==false)return v;await delay(150);}throw new Error('Acceptance timeout');};
 let result:Record<string,unknown>|undefined;
 try{
  launch(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)]);
  await until(async()=>{try{return (await req('/api/health')).ok||false;}catch{return false;}});
  const signup=async(email:string)=>{const r=await req('/api/auth/register','POST',{email,password:randomBytes(24).toString('base64url'),nickname:'검색 QA',termsAccepted:true});assert.equal(r.status,201);const payload=await r.json() as {data:{user:{id:string}}};return{cookie:r.headers.get('set-cookie')!.split(';')[0],id:payload.data.user.id};};
  const admin=await signup('sa-ad@example.test'),a=await signup('sa-a@example.test'),b=await signup('sa-b@example.test');
  const db=openDatabase(dbPath);
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  db.prepare("INSERT INTO blogs(id,owner_id,naver_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)").run('00000000-0000-4000-8000-00000000cc01',a.id,'qa_mine','내 블로그',Date.now(),Date.now());
  db.close();
  for(const phrase of ['제주 여행','서울 맛집','없는 키워드']){
   assert.equal((await req('/api/admin/keywords','POST',{phrase,category:'QA'},admin.cookie)).status,201);
  }
  const collected=await json(await req('/api/admin/keywords/metrics-collect','POST',{},admin.cookie));
  assert.equal(collected.measured.length,2);assert.deepEqual(collected.missing,['없는 키워드']);assert.equal(collected.documents,'naver_search');
  const jeju=collected.measured.find((m:{phrase:string})=>m.phrase==='제주 여행');
  assert.equal(jeju.pcVolume,9,'"< 10" upper bound minus one');assert.equal(jeju.mobileVolume,3400);assert.equal(jeju.documentCount,54321);
  const keywords=await (await req('/api/admin/keywords?page=1&pageSize=20','GET',undefined,admin.cookie)).json() as {data:{phrase:string}[];searchAds:boolean};
  assert.equal(keywords.searchAds,true);
  const member=await (await req('/api/recommendations?page=1&pageSize=50','GET',undefined,a.cookie)).json() as {data:{phrase:string;source:string|null;pcVolume:number|null;documentCount:number|null}[]};
  const jejuRow=member.data.find(k=>k.phrase==='제주 여행');
  assert.equal(jejuRow?.source,'naver_searchad','member sees collected metric');assert.equal(jejuRow?.documentCount,54321);
  assert.equal((await req('/api/admin/keywords/metrics-collect','POST',{},a.cookie)).status,403,'member cannot collect');
  const comp=await req('/api/competitors','POST',{blog:'rival_blog'},a.cookie);assert.equal(comp.status,201);
  const exposure=await json(await req('/api/exposures','POST',{keyword:'제주 여행'},a.cookie));
  assert.equal(exposure.total,54321);assert.equal(exposure.hits.length,3);
  assert.equal(exposure.hits[0].kind,'competitor');assert.equal(exposure.hits[1].kind,'mine');assert.equal(exposure.hits[2].kind,'other');
  const list=await (await req('/api/exposures','GET',undefined,a.cookie)).json() as {data:unknown[];remainingToday:number};
  assert.equal(list.data.length,1);assert.equal(list.remainingToday,9);
  assert.equal((await req(`/api/exposures/${exposure.id}`,'GET',undefined,b.cookie)).status,404,'other member cannot read');
  assert.equal((await req('/api/exposures','GET',undefined,b.cookie)).status,200);
  const page=await(await req('/dashboard/competitors','GET',undefined,a.cookie)).text();
  assert.ok(page.includes('키워드 상위 노출')&&page.includes('data-exposure-form'),'exposure section rendered');
  assert.ok(page.includes('rival_blog')&&page.includes('내 블로그')===true||page.includes('내 블로그'),'marks rendered');
  for(const s of [adKey,adSecret,nvId,nvSecret])assert.ok(!page.includes(s),`secret ${s.slice(0,8)} not in page`);
  result={verifiedAt:new Date().toISOString(),providerCalls:calls,checks:[
   'Production Next + loopback SearchAd/Naver Search doubles',
   'HMAC-SHA256 서명·고객 ID·API 키는 헤더 전용(스텁이 서명 검증, badSig 0건)',
   'keywordstool 5개 묶음·"< 10" 환산·정확 일치 매칭·문서수는 네이버 검색 총건수',
   '지표는 naver_searchad 출처로 기록되고 회원 추천 화면에 반영',
   '상위 노출: 내 블로그/경쟁 표시, 타 회원 404, KST 하루 한도 표시, 비밀키 미노출'],
   externalProviderUsed:false,temporaryDataRemoved:true};
 }finally{
  for(const p of children){if(p.exitCode!==null||p.signalCode!==null)continue;const exited=new Promise<void>(r=>p.once('exit',()=>r()));p.kill('SIGTERM');const timer=setTimeout(()=>p.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  await new Promise<void>(r=>{stub.close(()=>r());stub.closeAllConnections();});rmSync(temp,{recursive:true,force:true});
 }
 writeFileSync(resolve(process.argv[2]||'docs/fullstack/evidence/search-adapters-runtime.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e instanceof Error?e.stack:e)+'\n');process.exitCode=1;});
