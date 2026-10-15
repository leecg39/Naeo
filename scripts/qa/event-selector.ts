/** Production Next HTTP verification using an isolated database; no external writes. */
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createEvent} from '../../src/server/events/events';

async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-event-selector-')),dbPath=join(temp,'db.sqlite');let child:ChildProcess|undefined;
 const password=randomBytes(32).toString('base64url');let result;
 try{
  const db=openDatabase(dbPath);try{const {user}=await register(db,{email:'admin@example.test',password,nickname:'관리자',termsAccepted:true});db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
   const seedNow=Date.now();
   for(let i=0;i<101;i++)for(const acceptsEntries of [true,false])createEvent(db,user.id,{slug:`${acceptsEntries?'eligible':'ineligible'}-${i}`,title:acceptsEntries?`Eligible event ${i}`:`No entries ${i}`,status:'published',startsAt:new Date(seedNow-86400000-(acceptsEntries?i+1000:0)).toISOString(),endsAt:new Date(seedNow+86400000).toISOString(),acceptsEntries});
  }finally{db.close();}
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
  const origin=`http://127.0.0.1:${port}`;
  const req=(path:string,method='GET',data?:unknown,cookie?:string)=>fetch(origin+path,{method,headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads')},stdio:'ignore'});
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('Next exited before readiness');try{if((await req('/api/health')).ok){ready=true;break;}}catch{/* server startup */}await delay(100);}assert.ok(ready);
  const login=await req('/api/auth/login','POST',{email:'admin@example.test',password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const response=await req('/api/admin/events?acceptsEntries=true&page=6&pageSize=20','GET',undefined,cookie);assert.equal(response.status,200);
  const events=await response.json();assert.equal(events.pagination.total,101);assert.equal(events.data.length,1);assert.equal(events.data[0].slug,'eligible-100');
  const page=await req('/admin/event?slug=eligible-100','GET',undefined,cookie);assert.equal(page.status,200);assert.ok((await page.text()).includes('Eligible event 100'),'selected event outside first page retained in SSR');
  const search=await req('/api/admin/events?acceptsEntries=true&q=Eligible%20event%20100','GET',undefined,cookie);assert.equal((await search.json()).pagination.total,1);
  const invalid=await req('/admin/event?slug=missing-event','GET',undefined,cookie);assert.ok(invalid.status===404||(await invalid.text()).includes('NEXT_HTTP_ERROR_FALLBACK;404'));
  const excluded=await req('/admin/event?slug=ineligible-100','GET',undefined,cookie);assert.ok(excluded.status===404||(await excluded.text()).includes('NEXT_HTTP_ERROR_FALLBACK;404'));
  result={verifiedAt:new Date().toISOString(),checks:['202 events seeded in isolated database','API filters eligible events before pagination','Page 6 returns eligible event 101','Direct review page preserves eligible-100 in SSR','Event title search reaches last event','Missing/ineligible explicit slug does not silently select a different event'],browserVerified:false,temporaryDataRemoved:true};
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const processToStop=child,exited=new Promise<void>(r=>processToStop.once('exit',()=>r()));processToStop.kill('SIGTERM');const timer=setTimeout(()=>processToStop.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  rmSync(temp,{recursive:true,force:true});
 }
 writeFileSync(resolve(process.argv[2]||'docs/fullstack/evidence/event-selector-runtime.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
