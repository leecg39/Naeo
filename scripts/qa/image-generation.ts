/** Isolated production HTTP + worker verification of AI image generation against loopback OpenAI Images/Anthropic doubles. No external calls. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {openDatabase} from '../../src/server/database';

const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(2048,7)]);
const freePort=async()=>{const probe=tcpServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));return port;};
async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-imagegen-http-')),children:ChildProcess[]=[];
 const anthropicKey=randomBytes(16).toString('hex'),imageKey=randomBytes(16).toString('hex');
 const calls:{anthropic:number;images:number;imageAuthFail:number}={anthropic:0,images:0,imageAuthFail:0};
 const provider=createServer((q,r)=>{let body='';q.on('data',c=>body+=c);q.on('end',()=>{
  r.setHeader('Content-Type','application/json');
  if(q.url==='/v1/messages'){calls.anthropic++;if(q.headers['x-api-key']!==anthropicKey)return r.writeHead(401).end('{"error":{"message":"bad key"}}');const b=JSON.parse(body) as {messages?:{content?:string}[]};const title=(b.messages?.[0]?.content||'').includes('제주')?'제주 3박 4일 후기':'생성 글';r.writeHead(200).end(JSON.stringify({content:[{type:'text',text:'# '+title+'\n\n## 첫째 날\n\n도착했어요.'}]}));return;}
  if(q.url==='/v1/images/generations'){calls.images++;if(q.headers.authorization!==`Bearer ${imageKey}`){calls.imageAuthFail++;return r.writeHead(401).end('{"error":{"message":"bad key"}}');}const b=JSON.parse(body);
   if(calls.images===3)return r.writeHead(200).end(JSON.stringify({data:[{b64_json:Buffer.from('garbage-not-an-image').toString('base64')}]}));
   r.writeHead(200).end(JSON.stringify({data:[{b64_json:PNG.toString('base64'),revised_prompt:b.prompt?.slice(0,50)}]}));return;}
  r.writeHead(404).end('{}');
 });});
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));const stub=(provider.address() as {port:number}).port;
 const port=await freePort(),origin=`http://127.0.0.1:${port}`,dbPath=join(temp,'db.sqlite');
 const env={...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads'),NAEO_WORKER_IDLE_MS:'100',
  ANTHROPIC_API_KEY:anthropicKey,NAEO_AI_BASE_URL:`http://127.0.0.1:${stub}`,
  NAEO_IMAGE_PROVIDER:'openai',NAEO_IMAGE_API_KEY:imageKey,NAEO_IMAGE_API_BASE:`http://127.0.0.1:${stub}`};
 const launch=(args:string[])=>{const p=spawn(process.execPath,args,{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});p.stdout!.on('data',()=>{});p.stderr!.on('data',()=>{});children.push(p);return p;};
 const req=(path:string,method='GET',data?:unknown,cookie?:string)=>fetch(origin+path,{method,headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const json=async(r:Response)=>(await r.json()).data;
 const until=async<T>(check:()=>Promise<T|false>)=>{const end=Date.now()+45000;while(Date.now()<end){const v=await check();if(v!==false)return v;await delay(150);}throw new Error('Acceptance timeout');};
 let result:Record<string,unknown>|undefined;
 try{
  launch(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)]);
  await until(async()=>{try{return (await req('/api/health')).ok||false;}catch{return false;}});
  launch(['--import','tsx','scripts/worker.ts']);
  const signup=async(email:string)=>{const r=await req('/api/auth/register','POST',{email,password:randomBytes(24).toString('base64url'),nickname:'이미지 QA',termsAccepted:true});assert.equal(r.status,201);const payload=await r.json() as {data:{user:{id:string}}};return{cookie:r.headers.get('set-cookie')!.split(';')[0],id:payload.data.user.id};};
  const a=await signup('img-a@example.test'),b=await signup('img-b@example.test');
  const db=openDatabase(dbPath);
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(a.id);
  db.close();
  await req('/api/admin/credits','POST',{userId:a.id,delta:100,note:'QA 충전'},a.cookie);
  const write=await(await req('/dashboard/write','GET',undefined,a.cookie)).text();
  assert.ok(write.includes('data-image-cost="1"'),'page advertises the image cost');
  assert.ok(!write.includes(imageKey));
  const job=await json(await req('/api/generations','POST',{keyword:'제주 여행',category:'여행',title:'',experience:'3박 4일 다녀옴',instructions:'',photoIds:[],aiImages:3,idempotencyKey:'img-qa-1'},a.cookie));
  assert.equal(job.cost,13);
  const done=await until(async()=>{const j=await json(await req(`/api/generations/${job.id}`,'GET',undefined,a.cookie));return ['succeeded','failed','canceled'].includes(j.state)?j:false;});
  assert.equal(done.state,'succeeded');assert.equal(done.imagesMade,2);assert.equal(done.errorCode,'IMAGE_PARTIAL');
  const mediaRes=await req(`/api/media?draftId=${done.draftId}`,'GET',undefined,a.cookie);
  const rawMedia=await mediaRes.clone().text();
  const media=(await json(mediaRes)) as {publicId:string;source:string}[];
  assert.equal(mediaRes.status,200,`/api/media status ${rawMedia.slice(0,300)}`);assert.equal(media.length,2,JSON.stringify(media).slice(0,300));assert.ok(media.every(m=>m.source==='ai'));
  const image=await req(`/api/media/${media[0].publicId}`,'GET',undefined,a.cookie);
  assert.equal(image.status,200);assert.deepEqual([...new Uint8Array(await image.arrayBuffer()).slice(0,8)],[...PNG.subarray(0,8)]);
  assert.equal((await req(`/api/media/${media[0].publicId}`,'GET',undefined,b.cookie)).status,404);
  const credits=await (await req('/api/credits','GET',undefined,a.cookie)).json() as {balance:number;data:{reason:string;delta:number;note:string}[]};
  assert.equal(credits.balance,88,'100 -13 +1 partial refund for the failed third image');
  assert.ok(credits.data.find(e=>e.reason==='refund'&&e.delta===1&&e.note.includes('미생성')));
  const draft=await json(await req(`/api/drafts/${done.draftId}`,'GET',undefined,a.cookie));
  assert.match(draft.title,/제주 3박 4일 후기/);
  result={verifiedAt:new Date().toISOString(),providerCalls:calls,checks:['Production Next+worker with loopback Anthropic+OpenAI Images doubles','Cost = 10토큰 + 이미지 장당 1토큰, 원장 차감·부분 환급 일치','AI 이미지는 서명 검증 후 draft에 ai로 첨부, 비밀키 미노출, 타 회원 404','깨진 이미지 응답은 해당 장만 실패 처리하고 환급'],externalProviderUsed:false,temporaryDataRemoved:true};
 }finally{
  for(const p of children){if(p.exitCode!==null||p.signalCode!==null)continue;const exited=new Promise<void>(r=>p.once('exit',()=>r()));p.kill('SIGTERM');const timer=setTimeout(()=>p.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  await new Promise<void>(r=>{provider.close(()=>r());provider.closeAllConnections();});rmSync(temp,{recursive:true,force:true});
 }
 writeFileSync(resolve(process.argv[2]||'docs/fullstack/evidence/image-generation-runtime.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e instanceof Error?e.stack:e)+'\n');process.exitCode=1;});
