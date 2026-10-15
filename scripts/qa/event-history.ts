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
import {submitEntry} from '../../src/server/events/entries';
import {grantReward} from '../../src/server/events/rewards';
import {load} from 'cheerio';

async function main(){
 const temp=mkdtempSync(join(tmpdir(),'naeo-event-history-')),dbPath=join(temp,'db.sqlite');let child:ChildProcess|undefined;
 const password=randomBytes(32).toString('base64url');let result;
 try{
  const db=openDatabase(dbPath);try{const {user}=await register(db,{email:'admin@example.test',password,nickname:'관리자',termsAccepted:true});db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
   const seedNow=Date.now();
   for(let i=0;i<101;i++){
    createEvent(db,user.id,{slug:`history-${i}`,title:`History event ${i}`,status:'published',startsAt:new Date(seedNow-86400000).toISOString(),endsAt:new Date(seedNow+86400000).toISOString(),requiresProof:false,acceptsEntries:true});
    submitEntry(db,user.id,`history-${i}`,{note:'참여'},seedNow-i);
    grantReward(db,user.id,{userId:user.id,tokens:1,description:`History reward ${i}`},seedNow-i);
   }
  }finally{db.close();}
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
  const origin=`http://127.0.0.1:${port}`;
  const req=(path:string,method='GET',data?:unknown,cookie?:string)=>fetch(origin+path,{method,headers:{Origin:origin,...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,NAEO_APP_URL:origin,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:join(temp,'uploads')},stdio:'ignore'});
  let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('Next exited before readiness');try{if((await req('/api/health')).ok){ready=true;break;}}catch{/* server startup */}await delay(100);}assert.ok(ready);
  const login=await req('/api/auth/login','POST',{email:'admin@example.test',password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const response=await req('/api/me/events?entriesPage=2&rewardsPage=2','GET',undefined,cookie);assert.equal(response.status,200);
  const history=(await response.json()).data;assert.equal(history.entryPagination.total,101);assert.equal(history.rewardPagination.total,101);
  assert.equal(history.entries.length,1);assert.equal(history.entries[0].slug,'history-100');assert.equal(history.rewards[0].description,'History reward 100');
  const page=await req('/dashboard/events?entriesPage=2&rewardsPage=2','GET',undefined,cookie);assert.equal(page.status,200);
  const $=load(await page.text()),activity=$('#my-events');assert.equal(activity.length,1);assert.equal(activity.find('table').length,2);activity.find('table').each((_,table)=>assert.equal($(table).find('tbody tr').length,1));
  assert.ok(activity.text().includes('History event 100'));assert.ok(activity.text().includes('History reward 100'));
  assert.equal(activity.find('a[href="/dashboard/events/history-100"]').length,1);
  assert.equal(activity.find('a[href="/dashboard/events?entriesPage=1&rewardsPage=2#my-events"]').length,1);
  assert.equal(activity.find('a[href="/dashboard/events?entriesPage=2&rewardsPage=1#my-events"]').length,1);
  const entry=history.entries[0];const edit=await req(`/api/event-entries/${entry.id}`,'PATCH',{note:'Older entry updated',version:entry.version},cookie);assert.equal(edit.status,200);
  const withdrawal=await req(`/api/event-entries/${entry.id}/withdraw`,'POST',{version:entry.version+1},cookie);assert.equal(withdrawal.status,200);
  assert.equal((await req('/api/me/events')).status,401);
  assert.equal((await req('/api/me/events?entriesPage=0','GET',undefined,cookie)).status,400);
  const invalid=await req('/dashboard/events?entriesPage=0','GET',undefined,cookie);assert.ok(invalid.status===404||(await invalid.text()).includes('NEXT_HTTP_ERROR_FALLBACK;404'));
  result={verifiedAt:new Date().toISOString(),checks:['101 member entries and rewards','API page two contains record 101','SSR activity section contains selected history only','SSR independent pagination links preserve other page','SSR participation title links to editable event detail','Page-two entry update and withdrawal','Anonymous request denied and invalid page rejected'],browserVerified:false,temporaryDataRemoved:true};
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const processToStop=child,exited=new Promise<void>(r=>processToStop.once('exit',()=>r()));processToStop.kill('SIGTERM');const timer=setTimeout(()=>processToStop.kill('SIGKILL'),3000);await exited;clearTimeout(timer);}
  rmSync(temp,{recursive:true,force:true});
 }
 writeFileSync(resolve(process.argv[2]||'docs/fullstack/evidence/event-history-runtime.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(e=>{process.stderr.write(String(e)+'\n');process.exitCode=1;});
