import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {openDatabase,transaction} from '../../src/server/database';
import {migrations} from '../../src/server/migrations';
import {register} from '../../src/server/auth';
import {createApi} from '../../src/server/api';
import {addSlide,createProject,deleteProject,getProject} from '../../src/server/creative/projects';
import {addPage,cancelExport,cleanupExports,completeExport,exportPath,getExport,KEEP_TTL,readExportFile,startExport} from '../../src/server/creative/exports';
import {runCreativeExportOnce,MP4_MAX_ATTEMPTS} from '../../src/server/creative/worker';
import {encoderPath,mp4Capability} from '../../src/server/creative/mp4';
import {buildPersonalArchive} from '../../src/server/privacy/archive';
import {solidPng} from './helpers/png-fixture';

const exec=promisify(execFile);
async function fixture(t:TestContext,kind:'video'|'ad'='video'){
 const dir=mkdtempSync(join(tmpdir(),'naeo-mp4-')),db=openDatabase(':memory:');
 const previous=process.env.NAEO_FFMPEG_PATH;
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.NAEO_FFMPEG_PATH;else process.env.NAEO_FFMPEG_PATH=previous;});
 const owner=(await register(db,{email:'video@example.test',password:'mp4-test-long-password',nickname:'영상',termsAccepted:true})).user.id;
 const project=createProject(db,owner,{kind,title:'내 영상/테스트'});
 const queue=(secondsPerSlide=1)=>{
  const p=getProject(db,owner,project.id),job=startExport(db,owner,p.id,{format:'mp4',secondsPerSlide});
  p.slides.forEach((_,i)=>addPage(db,dir,owner,job.id,i,solidPng(p.width,p.height,i?[0,0,255,255]:[255,0,0,255])));
  assert.equal(completeExport(db,dir,owner,job.id).state,'queued');return job;
 };
 return{db,dir,owner,project,queue};
}
function fakeEncoder(dir:string,behavior:'fail'|'hang'){
 const file=join(dir,`fake-${behavior}`);
 writeFileSync(file,`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv.includes('-encoders'))console.log(' V..... libx264 H.264');else {fs.writeFileSync(${JSON.stringify(file+'.started')},'started');${behavior==='fail'?'process.exit(1);':'setInterval(()=>{},1000);'}}\n`,{mode:0o700});
 process.env.NAEO_FFMPEG_PATH=file;return file;
}
async function waitFor(check:()=>boolean){for(let i=0;i<300&&!check();i++)await new Promise(r=>setTimeout(r,10));assert.ok(check(),'subprocess reached expected state');}
function unpack(bytes:Buffer){const files:Record<string,Buffer>={};for(let o=0;o+512<=bytes.length;){const h=bytes.subarray(o,o+512);if(h.every(v=>!v))break;const name=h.subarray(0,100).toString().split('\0')[0],size=parseInt(h.subarray(124,136).toString(),8);files[name]=bytes.subarray(o+512,o+512+size);o+=512+Math.ceil(size/512)*512;}return files;}

test('real MP4 encoder: ordered silent 1080p H.264/yuv420p, private download, TAR inclusion and expiry',async t=>{
 let binary:string;try{binary=encoderPath();}catch{t.skip('FFmpeg unavailable; set NAEO_FFMPEG_PATH for the real encoding test');return;}
 const {db,dir,owner,project,queue}=await fixture(t);process.env.NAEO_FFMPEG_PATH=binary;
 addSlide(db,owner,project.id,{heading:'blue'});
 const job=queue();assert.equal(job.secondsPerSlide,1);
 assert.throws(()=>readExportFile(db,dir,owner,job.id),{status:404});
 const queued=startExport(db,owner,project.id,{format:'mp4'});assert.equal(queued.secondsPerSlide,3);
 addPage(db,dir,owner,queued.id,0,solidPng(1920,1080));
 await runCreativeExportOnce(db,dir,'test-real');
 const done=getExport(db,owner,job.id);assert.equal(done.state,'succeeded',done.error);assert.equal(done.progress,100);
 assert.equal(readdirSync(join(dir,'exports')).filter(p=>p.startsWith('mp4-')).length,0);
 const download=readExportFile(db,dir,owner,job.id);assert.equal(download.mime,'video/mp4');assert.equal(download.filename,'내 영상_테스트.mp4');
 assert.ok(download.bytes.indexOf(Buffer.from('moov'))<download.bytes.indexOf(Buffer.from('mdat')),'faststart metadata precedes video');
 const key=db.prepare('SELECT file_key FROM export_jobs WHERE id=?').get(job.id)!.file_key as string,path=exportPath(dir,key);
 assert.equal(statSync(path).mode&0o777,0o600);
 const ffprobe=process.env.NAEO_FFPROBE_PATH||join(dirname(binary),'ffprobe');
 const info=JSON.parse((await exec(ffprobe,['-v','error','-show_streams','-show_format','-of','json',path])).stdout);
 assert.equal(info.streams.length,1);assert.equal(info.streams[0].codec_name,'h264');assert.equal(info.streams[0].pix_fmt,'yuv420p');
 assert.equal(info.streams[0].width,1920);assert.equal(info.streams[0].height,1080);assert.ok(Math.abs(Number(info.format.duration)-2)<0.05);
 for(const [time,color] of [[0.5,0],[1.5,2]]){
  const {stdout}=await exec(binary,['-v','error','-ss',String(time),'-i',path,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer'});
  assert.equal(stdout.length,3);assert.ok(stdout[color]>240);assert.ok(stdout[(color+1)%3]<15);assert.ok(stdout[(color+2)%3]<15);
 }
 const foreign=(await register(db,{email:'foreign@example.test',password:'mp4-test-long-password',nickname:'다른 사람',termsAccepted:true})).user.id;
 assert.throws(()=>getExport(db,foreign,job.id),{status:404});assert.throws(()=>readExportFile(db,dir,foreign,job.id),{status:404});assert.throws(()=>cancelExport(db,dir,foreign,queued.id),{status:404});
 mkdirSync(join(dir,'personal-exports'));
 const archiveKey='a'.repeat(64)+'.tar';transaction(db,()=>buildPersonalArchive(db,dir,owner,archiveKey,Date.now()));
 const archive=unpack(readFileSync(join(dir,'personal-exports',archiveKey)));
 assert.deepEqual(archive[`attachments/creative/${job.id}.mp4`],download.bytes);
 assert.ok(archive[`attachments/creative_page/${queued.id}-0.png`]);
 assert.throws(()=>readExportFile(db,dir,owner,job.id,done.expiresAt),{status:410});
 cleanupExports(db,dir,done.expiresAt+1);assert.ok(!existsSync(path));
 for(const kind of ['ad','carousel'] as const){
  const p=createProject(db,owner,{kind,title:kind}),j=startExport(db,owner,p.id,{format:'mp4',secondsPerSlide:1});
  addPage(db,dir,owner,j.id,0,solidPng(p.width,p.height));completeExport(db,dir,owner,j.id);
  await runCreativeExportOnce(db,dir,'test-presets');assert.equal(getExport(db,owner,j.id).state,'succeeded');
  const outputKey=db.prepare('SELECT file_key FROM export_jobs WHERE id=?').get(j.id)!.file_key as string;
  const metadata=JSON.parse((await exec(ffprobe,['-v','error','-show_streams','-of','json',exportPath(dir,outputKey)])).stdout);
  assert.deepEqual([metadata.streams[0].width,metadata.streams[0].height],[p.width,p.height]);
 }

});

test('MP4 validation, unavailable binary, queue bounds and incomplete/expired pages',async t=>{
 const f=await fixture(t);fakeEncoder(f.dir,'fail');
 for(const secondsPerSlide of [0,31,1.5,'3'])assert.throws(()=>startExport(f.db,f.owner,f.project.id,{format:'mp4',secondsPerSlide}));
 assert.throws(()=>startExport(f.db,f.owner,f.project.id,{format:'pdf',secondsPerSlide:3}));
 const first=startExport(f.db,f.owner,f.project.id,{format:'mp4'});
 assert.throws(()=>completeExport(f.db,f.dir,f.owner,first.id),{code:'PAGES_MISSING'});
 startExport(f.db,f.owner,f.project.id,{format:'mp4'});
 assert.throws(()=>startExport(f.db,f.owner,f.project.id,{format:'mp4'}),{code:'EXPORT_BUSY'});
 cancelExport(f.db,f.dir,f.owner,first.id);
 assert.throws(()=>addPage(f.db,f.dir,f.owner,first.id,0,solidPng(1920,1080)),{code:'EXPORT_CLOSED'});
 process.env.NAEO_FFMPEG_PATH=join(f.dir,'missing');
 assert.equal((await mp4Capability()).available,false);
 assert.throws(()=>startExport(f.db,f.owner,f.project.id,{format:'mp4'}),{status:503,code:'EXPORT_ENCODER_UNAVAILABLE'});
 const expired=startExport(f.db,f.owner,f.project.id,{format:'pdf'},Date.now()-KEEP_TTL);
 assert.throws(()=>completeExport(f.db,f.dir,f.owner,expired.id),{code:'EXPORT_EXPIRED'});
});

test('worker failures and timeouts remove sources and temporary output',async t=>{
 const f=await fixture(t);fakeEncoder(f.dir,'fail');
 const failed=f.queue();await runCreativeExportOnce(f.db,f.dir,'failure');
 assert.equal(getExport(f.db,f.owner,failed.id).state,'failed');assert.equal(readdirSync(join(f.dir,'exports')).length,0);
 const missing=f.queue();process.env.NAEO_FFMPEG_PATH=join(f.dir,'missing');await runCreativeExportOnce(f.db,f.dir,'missing');
 assert.equal(getExport(f.db,f.owner,missing.id).state,'failed');assert.match(getExport(f.db,f.owner,missing.id).error,/사용할 수 없습니다/);assert.equal(readdirSync(join(f.dir,'exports')).length,0);
 fakeEncoder(f.dir,'hang');const timed=f.queue();await runCreativeExportOnce(f.db,f.dir,'timeout',{timeoutMs:100});
 assert.equal(getExport(f.db,f.owner,timed.id).state,'failed');assert.match(getExport(f.db,f.owner,timed.id).error,/제한 시간/);assert.equal(readdirSync(join(f.dir,'exports')).length,0);
});

test('worker single lease, graceful shutdown requeues, explicit cancel cannot publish',async t=>{
 const f=await fixture(t),fake=fakeEncoder(f.dir,'hang'),job=f.queue(),controller=new AbortController();
 const active=runCreativeExportOnce(f.db,f.dir,'first',{signal:controller.signal});await waitFor(()=>existsSync(fake+'.started'));
 assert.equal(getExport(f.db,f.owner,job.id).state,'encoding');assert.equal(await runCreativeExportOnce(f.db,f.dir,'second'),null);
 controller.abort();await active;
 assert.equal(getExport(f.db,f.owner,job.id).state,'queued');assert.equal(f.db.prepare('SELECT attempt FROM export_jobs WHERE id=?').get(job.id)!.attempt,0);
 const again=runCreativeExportOnce(f.db,f.dir,'first');cancelExport(f.db,f.dir,f.owner,job.id);await again;
 assert.equal(getExport(f.db,f.owner,job.id).state,'canceled');assert.equal(readdirSync(join(f.dir,'exports')).length,0);
});

test('deleted project/account and expired leases cannot publish; retry ceiling is bounded',async t=>{
 const f=await fixture(t),fake=fakeEncoder(f.dir,'hang'),job=f.queue();
 const active=runCreativeExportOnce(f.db,f.dir,'deleted');await waitFor(()=>existsSync(fake+'.started'));
 deleteProject(f.db,f.owner,f.project.id,{version:getProject(f.db,f.owner,f.project.id).version});await active;
 assert.throws(()=>getExport(f.db,f.owner,job.id),{status:404});assert.equal(readdirSync(join(f.dir,'exports')).filter(p=>p.startsWith('mp4-')||p.endsWith('.mp4')).length,0);
 const p=createProject(f.db,f.owner,{kind:'video',title:'recover'}),j=startExport(f.db,f.owner,p.id,{format:'mp4'});
 f.db.prepare("UPDATE export_jobs SET state='encoding',lease_until=?,lease_token='stale',attempt=? WHERE id=?").run(Date.now()-1,MP4_MAX_ATTEMPTS,j.id);
 assert.equal(await runCreativeExportOnce(f.db,f.dir,'recover'),null);assert.equal(getExport(f.db,f.owner,j.id).state,'failed');
 const recover=startExport(f.db,f.owner,p.id,{format:'mp4'});addPage(f.db,f.dir,f.owner,recover.id,0,solidPng(1920,1080));completeExport(f.db,f.dir,f.owner,recover.id);
 f.db.prepare("UPDATE export_jobs SET state='encoding',lease_until=?,lease_token='stale',attempt=1 WHERE id=?").run(Date.now()-1,recover.id);
 fakeEncoder(f.dir,'fail');await runCreativeExportOnce(f.db,f.dir,'recover');
 assert.equal(f.db.prepare('SELECT attempt FROM export_jobs WHERE id=?').get(recover.id)!.attempt,2);assert.equal(getExport(f.db,f.owner,recover.id).state,'failed');
 const account=startExport(f.db,f.owner,p.id,{format:'mp4'});addPage(f.db,f.dir,f.owner,account.id,0,solidPng(1920,1080));completeExport(f.db,f.dir,f.owner,account.id);
 fakeEncoder(f.dir,'hang');const pending=runCreativeExportOnce(f.db,f.dir,'account');f.db.prepare('DELETE FROM users WHERE id=?').run(f.owner);await pending;
 assert.throws(()=>getExport(f.db,f.owner,account.id),{status:404});assert.equal(readdirSync(join(f.dir,'exports')).filter(p=>p.startsWith('mp4-')||p.endsWith('.mp4')).length,0);
});

test('migration 45 preserves legacy export jobs/pages and foreign key cascade',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'naeo-mp4-migration-')),path=join(dir,'legacy.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const old=new DatabaseSync(path);old.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL) STRICT;');
 for(const m of migrations.filter(m=>m.version<45)){old.exec(m.sql);old.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(m.version,m.name,createHash('sha256').update(m.sql).digest('hex'),Date.now());}
 const owner=(await register(old,{email:'legacy@example.test',password:'migration-long-password',nickname:'old',termsAccepted:true})).user.id;
 const p=createProject(old,owner,{kind:'ad',title:'legacy'});
 old.prepare("INSERT INTO export_jobs(id,project_id,owner_id,format,state,slide_count,width,height,file_key,file_size,expires_at,created_at,updated_at) VALUES('complete',?,?,'zip','succeeded',1,1080,1350,?,99,100,1,1)").run(p.id,owner,'a'.repeat(32)+'.zip');
 old.prepare("INSERT INTO export_jobs(id,project_id,owner_id,format,slide_count,width,height,expires_at,created_at,updated_at) VALUES('collecting',?,?,'pdf',1,1080,1350,100,1,1)").run(p.id,owner);
 old.prepare("INSERT INTO export_pages VALUES('collecting',0,?,123)").run('b'.repeat(32)+'.png');old.close();
 const db=openDatabase(path);t.after(()=>db.close());
 assert.equal(db.prepare('SELECT count(*) AS n FROM export_jobs').get()!.n,2);assert.equal(db.prepare('SELECT count(*) AS n FROM export_pages').get()!.n,1);
 assert.equal(db.prepare("SELECT progress FROM export_jobs WHERE id='complete'").get()!.progress,100);assert.equal(db.prepare("SELECT seconds_per_slide FROM export_jobs WHERE id='collecting'").get()!.seconds_per_slide,3);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 db.prepare('DELETE FROM creative_projects WHERE id=?').run(p.id);assert.equal(db.prepare('SELECT count(*) AS n FROM export_pages').get()!.n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM export_jobs').get()!.n,0);
});

test('lease replacement while encoder runs fences completion and leaves the new owner state intact',async t=>{
 const f=await fixture(t),fake=fakeEncoder(f.dir,'hang'),job=f.queue();
 const active=runCreativeExportOnce(f.db,f.dir,'old-worker');await waitFor(()=>existsSync(fake+'.started'));
 f.db.prepare("UPDATE export_jobs SET lease_token='new-worker-token',lease_until=? WHERE id=?").run(Date.now()+60_000,job.id);
 await active;
 const row=f.db.prepare('SELECT state,lease_token,file_key FROM export_jobs WHERE id=?').get(job.id)!;
 assert.equal(row.state,'encoding');assert.equal(row.lease_token,'new-worker-token');assert.equal(row.file_key,null);
 assert.equal(getExport(f.db,f.owner,job.id).received,1);assert.equal(readdirSync(join(f.dir,'exports')).filter(p=>p.startsWith('mp4-')||p.endsWith('.mp4')).length,0);
});

test('MP4 HTTP contract: capabilities, 503 unavailable, queued 202, owner-only progress/cancel',async t=>{
 const f=await fixture(t),origin='http://127.0.0.1:3000',before=process.env.NAEO_UPLOAD_DIR,appBefore=process.env.NAEO_APP_URL;
 process.env.NAEO_UPLOAD_DIR=f.dir;process.env.NAEO_APP_URL=origin;
 t.after(()=>{if(before===undefined)delete process.env.NAEO_UPLOAD_DIR;else process.env.NAEO_UPLOAD_DIR=before;if(appBefore===undefined)delete process.env.NAEO_APP_URL;else process.env.NAEO_APP_URL=appBefore;});
 const handler=createApi(()=>f.db);
 const send=(path:string,method='GET',body?:unknown,cookie?:string)=>handler(new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}));
 const registerHttp=async(email:string)=>(await send('/api/auth/register','POST',{email,password:'mp4-http-long-password',nickname:'HTTP',termsAccepted:true})).headers.get('set-cookie')!.split(';')[0];
 const cookie=await registerHttp('http@example.test'),other=await registerHttp('http-other@example.test');
 const p=(await (await send('/api/creative/projects','POST',{kind:'video',title:'HTTP MP4'},cookie)).json()).data;
 process.env.NAEO_FFMPEG_PATH=join(f.dir,'missing');
 assert.equal((await send('/api/creative/export-capabilities')).status,401);
 const unavailable=await send(`/api/creative/projects/${p.id}/exports`,'POST',{format:'mp4'},cookie);assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).error.code,'EXPORT_ENCODER_UNAVAILABLE');
 assert.equal((await (await send('/api/creative/export-capabilities','GET',undefined,cookie)).json()).data.mp4.available,false);
 fakeEncoder(f.dir,'fail');
 assert.ok((await (await send('/api/creative/export-capabilities','GET',undefined,cookie)).json()).data.formats.includes('mp4'));
 const created=await send(`/api/creative/projects/${p.id}/exports`,'POST',{format:'mp4',secondsPerSlide:2},cookie);assert.equal(created.status,201);const job=(await created.json()).data;
 assert.equal((await send(`/api/creative/exports/${job.id}`,'GET',undefined,other)).status,404);
 const upload=await handler(new Request(origin+`/api/creative/exports/${job.id}/pages/0`,{method:'PUT',headers:{Origin:origin,Cookie:cookie,'Content-Type':'image/png'},body:new Uint8Array(solidPng(1920,1080))}));assert.equal(upload.status,200);
 const complete=await send(`/api/creative/exports/${job.id}/complete`,'POST',{},cookie);assert.equal(complete.status,202);assert.equal((await complete.json()).data.state,'queued');
 assert.equal((await send(`/api/creative/exports/${job.id}/file`,'GET',undefined,cookie)).status,404);
 assert.equal((await send(`/api/creative/exports/${job.id}`,'DELETE',undefined,other)).status,404);
 const cancel=await send(`/api/creative/exports/${job.id}`,'DELETE',undefined,cookie);assert.equal(cancel.status,200);assert.equal((await cancel.json()).data.state,'canceled');
 assert.equal((await (await send(`/api/creative/exports/${job.id}`,'GET',undefined,cookie)).json()).data.state,'canceled');
});
