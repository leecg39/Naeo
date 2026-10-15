/** Isolated production HTTP + worker acceptance run. Uses generated credentials only in memory. */
import {migrations} from '../../src/server/migrations';
import assert from 'node:assert/strict';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
async function main(){
const root=process.cwd(),temp=mkdtempSync(join(tmpdir(),'naeo-export-http-'));
const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>((r,e)=>probe.close(error=>error?e(error):r()));
const origin=`http://127.0.0.1:${port}`,uploads=join(temp,'uploads'),env={...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:join(temp,'db.sqlite'),NAEO_UPLOAD_DIR:uploads,NAEO_WORKER_IDLE_MS:'100'};
const children:ChildProcess[]=[];const checks:string[]=[];
function launch(args:string[]){const p=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});p.stdout!.on('data',()=>{});p.stderr!.on('data',()=>{});children.push(p);return p;}
async function stop(p:ChildProcess){if(p.exitCode!==null||p.signalCode!==null)return;const exited=new Promise<void>(r=>p.once('exit',()=>r()));p.kill('SIGTERM');const timer=setTimeout(()=>p.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
async function until<T>(check:()=>Promise<T|false>,seconds=30){const end=Date.now()+seconds*1000;while(Date.now()<end){const value=await check();if(value!==false)return value;await delay(150);}throw new Error('QA timeout');}
const password=randomBytes(24).toString('base64url');
async function request(path:string,method='GET',cookie?:string,data?:unknown){return fetch(origin+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});}
async function account(email:string){const r=await request('/api/auth/register','POST',undefined,{email,password,nickname:'내보내기 검증',termsAccepted:true});assert.equal(r.status,201);return{cookie:r.headers.get('set-cookie')!.split(';')[0],user:(await r.json()).data.user};}
let result:Record<string,unknown>|undefined;
try{
 const web=launch(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)]);
 await until(async()=>{try{return(await fetch(origin+'/api/health')).ok;}catch{return false;}});
 const health=await(await request('/api/health')).json();assert.equal(health.data.schemaVersion,migrations.at(-1)!.version);
 const a=await account('personal-export-a@example.test'),b=await account('personal-export-b@example.test');
 for(const u of [a,b]){const r=await request('/api/drafts','POST',u.cookie,{title:u===a?'내 기록':'비공개 다른 기록',body:'개인정보 내보내기 실제 HTTP 검증'});assert.equal(r.status,201);}
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 const form=new FormData();form.set('file',new Blob([image],{type:'image/png'}),'검증 사진.png');const uploaded=await fetch(origin+'/api/media',{method:'POST',headers:{Origin:origin,Cookie:a.cookie},body:form});assert.equal(uploaded.status,201);
 const html=await(await request('/dashboard/settings','GET',a.cookie)).text();assert.ok(html.includes('내 데이터 내려받기'));checks.push('settings SSR renders the export form (not browser hydration)');
 assert.equal((await request('/api/auth/data-exports','POST',a.cookie,{currentPassword:'wrong'})).status,403);
 const asked=await request('/api/auth/data-exports','POST',a.cookie,{currentPassword:password});assert.equal(asked.status,202);const job=(await asked.json()).data;assert.equal(job.state,'queued');
 assert.equal((await request(`/api/auth/data-exports/${job.id}/download`,'GET',a.cookie)).status,409);
 assert.equal((await request(`/api/auth/data-exports/${job.id}/download`,'GET',b.cookie)).status,404);checks.push('reauthentication, queued state and cross-owner denial over real HTTP');
 const worker=launch(['--import','tsx','scripts/worker.ts']);
 await until(async()=>{const list=(await(await request('/api/auth/data-exports','GET',a.cookie)).json()).data;const item=list.find((j:{id:string})=>j.id===job.id);if(item?.state==='failed')throw new Error('Archive failed');return item?.state==='succeeded';});
 const downloaded=await request(`/api/auth/data-exports/${job.id}/download`,'GET',a.cookie);assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('cache-control'),'no-store');
 const bytes=Buffer.from(await downloaded.arrayBuffer()),archive=join(temp,'data.tar');writeFileSync(archive,bytes);
 const member=(name:string)=>execFileSync('/usr/bin/tar',['-xOf',archive,name],{maxBuffer:20*1024*1024});
 const manifest=JSON.parse(member('manifest.json').toString());
 for(const file of [...manifest.datasets,...manifest.attachments]){const content=member(file.path);assert.equal(content.length,file.size);assert.equal(createHash('sha256').update(content).digest('hex'),file.sha256);}
 assert.deepEqual(member(manifest.attachments[0].path),image);const drafts=member('data/drafts.ndjson').toString();assert.ok(drafts.includes('내 기록'));assert.ok(!drafts.includes('비공개 다른 기록'));
 const contents=manifest.datasets.map((d:{path:string})=>member(d.path).toString()).join('');for(const secret of [password,a.cookie.split('=')[1],b.user.email,'password_hash','payment_key','storage_key'])assert.ok(!contents.includes(secret));
 checks.push('real worker builds archive; system tar reads all members; SHA-256, row isolation and attachment bytes match');
 await stop(worker);assert.equal((await request('/api/auth/logout','POST',a.cookie)).status,200);assert.equal((await request(`/api/auth/data-exports/${job.id}/download`,'GET',a.cookie)).status,401);
 const restarted=launch(['--import','tsx','scripts/worker.ts']);await until(async()=>readdirSync(join(uploads,'personal-exports')).length===0);await stop(restarted);checks.push('logout immediately denies download; restarted worker deletes persisted archive tombstone');
 await stop(web);
 result={verifiedAt:new Date().toISOString(),schemaVersion:migrations.at(-1)!.version,checks,archiveBytes:bytes.length,datasets:manifest.datasets.length,attachments:manifest.attachments.length,archiveSha256:createHash('sha256').update(bytes).digest('hex'),browserVerified:false,productionProvidersUsed:false,temporaryDataRemoved:true};

}finally{for(const p of children)await stop(p);rmSync(temp,{recursive:true,force:true});}
 const out=resolve(process.argv[2]||'docs/fullstack/evidence/personal-export-runtime.json');writeFileSync(out,JSON.stringify(result,null,2)+'\n');process.stdout.write(readFileSync(out));
}
main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
