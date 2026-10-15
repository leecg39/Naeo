import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync,utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createProject} from '../../src/server/creative/projects';
import {startExport,addPage,completeExport} from '../../src/server/creative/exports';
import {solidPng} from './helpers/png-fixture';
import {createHash,randomUUID} from 'node:crypto';
import {openDatabase} from '../../src/server/database';
import {register,createSession,tokenHash,logout} from '../../src/server/auth';
import {createApi} from '../../src/server/api';
import {saveUpload} from '../../src/server/writing/media';
import {requestPersonalExport,listPersonalExports,downloadPersonalExport,deletePersonalExport,runPersonalExportOnce,cleanupPersonalExports,EXPORT_TTL,LEASE_TTL} from '../../src/server/privacy/personal-export';
const password='synthetic-export-test-password',origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
async function fixture(t:TestContext,fileBacked=false){
 const dir=mkdtempSync(join(tmpdir(),'naeo-personal-export-')),db=openDatabase(fileBacked?join(dir,'fixture.sqlite'):':memory:');
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const a=await register(db,{email:'export-a@example.test',nickname:'내 자료',password,termsAccepted:true});
 const b=await register(db,{email:'export-b@example.test',nickname:'남의 자료',password,termsAccepted:true});
 const ask=()=>requestPersonalExport(db,a.user.id,a.session.token,{currentPassword:password});
 return {db,dir,a,b,ask};
}
function unpack(bytes:Buffer){
 const files:Record<string,Buffer>={};
 for(let offset=0;offset+512<=bytes.length;){
  const header=bytes.subarray(offset,offset+512);if(header.every(v=>v===0))break;
  const name=header.subarray(0,100).toString().replace(/\0[\s\S]*$/,''),size=parseInt(header.subarray(124,136).toString().replace(/\0[\s\S]*$/,''),8);
  files[name]=bytes.subarray(offset+512,offset+512+size);offset+=512+Math.ceil(size/512)*512;
 }
 return files;
}
const rows=(files:Record<string,Buffer>,table:string)=>files[`data/${table}.ndjson`].toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
test('personal archive includes owned records and exact media, excludes credentials and unrelated owner',async t=>{
 const {db,dir,a,b,ask}=await fixture(t);
 for(const u of [a,b]){
  db.prepare('INSERT INTO drafts(id,owner_id,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),u.user.id,u.user.email,'보존할 본문',1,1);
 }
 const media=saveUpload(db,dir,a.user.id,{bytes:Buffer.from([255,216,255,1,2,3]),name:'../한글 사진.jpg',type:'image/jpeg'});
 saveUpload(db,dir,b.user.id,{bytes:Buffer.from([255,216,255,9,8,7]),name:'private-other.jpg',type:'image/jpeg'});
 const j=await ask();assert.equal(j.state,'queued');assert.equal(runPersonalExportOnce(db,dir),true);
 const response=downloadPersonalExport(db,dir,a.user.id,a.session.token,j.id);assert.equal(response.headers.get('cache-control'),'no-store');
 const files=unpack(Buffer.from(await response.arrayBuffer())),manifest=JSON.parse(files['manifest.json'].toString());
 assert.equal(rows(files,'account')[0].email,a.user.email);assert.equal(rows(files,'drafts').length,1);
 assert.equal(rows(files,'drafts')[0].title,a.user.email);assert.ok(Object.keys(files).length>35);
 const attachment=manifest.attachments.find((x:{id:string})=>x.id===media.publicId);assert.deepEqual(files[attachment.path],Buffer.from([255,216,255,1,2,3]));
 const all=Object.values(files).map(b=>b.toString()).join('');
 for(const secret of [a.session.token,tokenHash(a.session.token),b.user.email,'private-other.jpg','password_hash','storage_key','scrypt$'])assert.ok(!all.includes(secret),secret);
 assert.throws(()=>downloadPersonalExport(db,dir,b.user.id,b.session.token,j.id),{status:404});
 assert.equal(listPersonalExports(db,a.user.id,createSession(db,a.user.id).token).length,0);
});
test('invalid password, revoked session during reauthentication, payload validation',async t=>{
 const {db,a,ask}=await fixture(t);
 await assert.rejects(()=>requestPersonalExport(db,a.user.id,a.session.token,{currentPassword:'wrong'}),{code:'REAUTHENTICATION_FAILED'});
 await assert.rejects(()=>requestPersonalExport(db,a.user.id,a.session.token,{currentPassword:password,ownerId:'other'}));
 const pending=ask();logout(db,a.session.token);await assert.rejects(pending,{status:401});
 assert.equal(db.prepare('SELECT count(*) AS n FROM personal_exports').get()!.n,0);
});
test('one active export per owner, early download rejected, cancellation, session cascade and durable cleanup',async t=>{
 const {db,dir,a,b,ask}=await fixture(t);const j=await ask();
 await assert.rejects(ask,{code:'EXPORT_EXISTS'});assert.throws(()=>downloadPersonalExport(db,dir,a.user.id,a.session.token,j.id),{status:409});
 assert.throws(()=>deletePersonalExport(db,b.user.id,b.session.token,j.id),{status:404});
 deletePersonalExport(db,a.user.id,a.session.token,j.id);assert.equal(runPersonalExportOnce(db,dir),false);
 const done=await ask();runPersonalExportOnce(db,dir);logout(db,a.session.token);
 assert.equal(db.prepare('SELECT count(*) AS n FROM personal_exports').get()!.n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM personal_export_deletions').get()!.n,1);
 cleanupPersonalExports(db,dir);assert.equal(readdirSync(join(dir,'personal-exports')).length,0);
 assert.throws(()=>downloadPersonalExport(db,dir,a.user.id,a.session.token,done.id),{status:401});
});
test('expired exports cannot download and cleanup deletes files; stale running lease is recovered',async t=>{
 const {db,dir,a,ask}=await fixture(t),j=await ask();
 db.prepare("UPDATE personal_exports SET state='running',lease_until=?,attempt=1 WHERE id=?").run(Date.now()-LEASE_TTL,j.id);
 runPersonalExportOnce(db,dir);assert.equal(listPersonalExports(db,a.user.id,a.session.token)[0].state,'succeeded');
 assert.throws(()=>downloadPersonalExport(db,dir,a.user.id,a.session.token,j.id,Date.now()+EXPORT_TTL),{status:410});
 cleanupPersonalExports(db,dir,Date.now()+EXPORT_TTL);assert.equal(readdirSync(join(dir,'personal-exports')).length,0);
});
test('missing attachment fails visibly and never delivers an incomplete archive',async t=>{
 const {db,dir,a,ask}=await fixture(t);
 saveUpload(db,dir,a.user.id,{bytes:Buffer.from([255,216,255]),name:'missing.jpg',type:'image/jpeg'});
 const key=db.prepare('SELECT storage_key FROM media_files').get()!.storage_key as string;rmSync(join(dir,key));
 const j=await ask();runPersonalExportOnce(db,dir);
 assert.equal(listPersonalExports(db,a.user.id,a.session.token)[0].state,'failed');
 assert.throws(()=>downloadPersonalExport(db,dir,a.user.id,a.session.token,j.id),{status:409});
 assert.equal(readdirSync(join(dir,'personal-exports')).length,0);
});
test('symlinked source and traversal storage key fail without reading outside uploads',async t=>{
 const {db,dir,a,ask}=await fixture(t);
 saveUpload(db,dir,a.user.id,{bytes:Buffer.from([255,216,255]),name:'source.jpg',type:'image/jpeg'});
 const key=db.prepare('SELECT storage_key FROM media_files').get()!.storage_key as string;rmSync(join(dir,key));writeFileSync(join(dir,'secret'),'private');symlinkSync(join(dir,'secret'),join(dir,key));
 const j=await ask();runPersonalExportOnce(db,dir);assert.equal(listPersonalExports(db,a.user.id,a.session.token)[0].state,'failed');deletePersonalExport(db,a.user.id,a.session.token,j.id);
 db.prepare("UPDATE media_files SET storage_key='../outside.jpg'").run();await ask();runPersonalExportOnce(db,dir);
 assert.equal(listPersonalExports(db,a.user.id,a.session.token)[0].state,'failed');assert.equal(readFileSync(join(dir,'secret'),'utf8'),'private');
});
test('all rows beyond UI pagination are exported, no silent result cap',async t=>{
 const {db,dir,a,ask}=await fixture(t);
 const insert=db.prepare('INSERT INTO point_ledger(id,owner_id,delta,reason,reference,created_at) VALUES(?,?,?,?,?,?)');
 for(let i=0;i<1200;i++)insert.run(randomUUID(),a.user.id,1,'attendance',`export-${i}`,i);
 const j=await ask();runPersonalExportOnce(db,dir);const files=unpack(Buffer.from(await downloadPersonalExport(db,dir,a.user.id,a.session.token,j.id).arrayBuffer()));assert.equal(rows(files,'points').length,1200);
});
test('crash orphan is cleaned after grace without touching fresh files or unrelated names',async t=>{
 const {db,dir,ask}=await fixture(t);await ask();runPersonalExportOnce(db,dir);
 const root=join(dir,'personal-exports'),stale='a'.repeat(64)+'.tar',fresh='b'.repeat(64)+'.tar';
 writeFileSync(join(root,stale),'partial');writeFileSync(join(root,fresh),'partial');writeFileSync(join(root,'keep.txt'),'other');utimesSync(join(root,stale),new Date(0),new Date(0));
 cleanupPersonalExports(db,dir);assert.ok(!readdirSync(root).includes(stale));assert.ok(readdirSync(root).includes(fresh));assert.ok(readdirSync(root).includes('keep.txt'));
});
test('HTTP origin, authentication, request/list/download/delete contracts',async t=>{
 const {db,dir,a}=await fixture(t),handler=createApi(()=>db);const previous=process.env.NAEO_UPLOAD_DIR;process.env.NAEO_UPLOAD_DIR=dir;t.after(()=>{if(previous===undefined)delete process.env.NAEO_UPLOAD_DIR;else process.env.NAEO_UPLOAD_DIR=previous;});
 const send=(path:string,method='GET',data?:unknown,originHeader=origin,cookie=true)=>handler(new Request(origin+path,{method,headers:{Origin:originHeader,'Content-Type':'application/json',...(cookie?{Cookie:`naeo_session=${a.session.token}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}));
 assert.equal((await send('/api/auth/data-exports','GET',undefined,origin,false)).status,401);
 assert.equal((await send('/api/auth/data-exports','POST',{currentPassword:password},'https://evil.test')).status,403);
 const requested=await send('/api/auth/data-exports','POST',{currentPassword:password});assert.equal(requested.status,202);const {id}=((await requested.json()).data);
 runPersonalExportOnce(db,dir);assert.equal((await send('/api/auth/data-exports')).status,200);
 const download=await send(`/api/auth/data-exports/${id}/download`);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition')!,/^attachment;/);await download.arrayBuffer();
 assert.equal((await send(`/api/auth/data-exports/${id}`,'DELETE')).status,200);
 assert.equal((await send(`/api/auth/data-exports/${id}/download`)).status,404);
});
test('OAuth-only accounts require recent login and local-password accounts cannot skip reauthentication',async t=>{
 const {db,a,ask}=await fixture(t);
 await assert.rejects(()=>requestPersonalExport(db,a.user.id,a.session.token,{}),{status:403});
 db.prepare("UPDATE users SET password_hash='!oauth-only' WHERE id=?").run(a.user.id);
 db.prepare('UPDATE sessions SET created_at=? WHERE token_hash=?').run(Date.now()-11*60_000,tokenHash(a.session.token));
 await assert.rejects(()=>requestPersonalExport(db,a.user.id,a.session.token,{}),{code:'REAUTH_REQUIRED'});
 const fresh=createSession(db,a.user.id);const j=await requestPersonalExport(db,a.user.id,fresh.token,{});assert.equal(j.state,'queued');
 await assert.rejects(ask,{code:'REAUTH_REQUIRED'});
});
test('inquiry replies include all delivery states but no staff ID; guest email match and other drafts excluded',async t=>{
 const {db,dir,a,b,ask}=await fixture(t);
 for(const [i,owner] of [a.user.id,b.user.id,null].entries()){
  const id=randomUUID();db.prepare("INSERT INTO inquiries(id,owner_id,email,type,message,created_at,updated_at) VALUES(?,?,?,'etc',?,1,1)").run(id,owner,a.user.email,`question-${i}`);
  for(const delivery of ['not_configured','failed','sent'])db.prepare('INSERT INTO inquiry_messages(id,inquiry_id,author_id,body,delivery,created_at,updated_at) VALUES(?,?,?,?,?,1,1)').run(randomUUID(),id,b.user.id,`reply-${i}`,delivery);
 }
 for(const owner of [a.user.id,b.user.id]){
  const id=randomUUID();db.prepare('INSERT INTO drafts(id,owner_id,title,body,created_at,updated_at) VALUES(?,?,?,?,1,1)').run(id,owner,'Draft',owner);
  db.prepare('INSERT INTO draft_revisions VALUES(?,?,1,?,?,1)').run(randomUUID(),id,'Revision',owner);
  db.prepare('INSERT INTO share_links(token,owner_id,draft_id,expires_at,created_at) VALUES(?,?,?,?,?)').run(owner===a.user.id?'A'.repeat(22):'B'.repeat(22),owner,id,999,1);
 }
 db.prepare('INSERT INTO audit_logs(id,actor_id,action,entity_type,entity_id,metadata,created_at) VALUES(?,?,?,?,?,?,1)').run(randomUUID(),a.user.id,'admin.user.update','user',b.user.id,JSON.stringify({email:b.user.email}));
 const j=await ask();runPersonalExportOnce(db,dir);const files=unpack(Buffer.from(await downloadPersonalExport(db,dir,a.user.id,a.session.token,j.id).arrayBuffer()));
 assert.equal(rows(files,'inquiries').length,1);assert.equal(rows(files,'inquiry_replies').length,3);assert.equal(rows(files,'draft_revisions').length,1);assert.equal(rows(files,'shares').length,1);
 const all=Object.values(files).map(b=>b.toString()).join('');for(const hidden of [b.user.id,b.user.email,'A'.repeat(22),'question-1','question-2','reply-1','author_id','"metadata"'])assert.ok(!all.includes(hidden),hidden);
});
test('creative final files and collecting pages are included with hashes; expired artifacts are metadata only',async t=>{
 const {db,dir,a,b,ask}=await fixture(t),now=Date.now();
 const p=createProject(db,a.user.id,{kind:'ad',title:'내 작품'}),other=createProject(db,b.user.id,{kind:'ad',title:'다른 작품'});
 for(const [project,owner] of [[p,a.user.id],[other,b.user.id]] as const){const j=startExport(db,owner,project.id,{format:'zip'});addPage(db,dir,owner,j.id,0,solidPng(1080,1350));completeExport(db,dir,owner,j.id);}
 const collecting=startExport(db,a.user.id,p.id,{format:'pdf'});addPage(db,dir,a.user.id,collecting.id,0,solidPng(1080,1350));
 const expired=startExport(db,a.user.id,p.id,{format:'zip'},now-8*86_400_000);db.prepare("UPDATE export_jobs SET state='succeeded',file_key=?,file_size=123 WHERE id=?").run('e'.repeat(32)+'.zip',expired.id);
 const j=await ask();runPersonalExportOnce(db,dir);const files=unpack(Buffer.from(await downloadPersonalExport(db,dir,a.user.id,a.session.token,j.id).arrayBuffer()));
 const manifest=JSON.parse(files['manifest.json'].toString());assert.equal(manifest.attachments.length,2);assert.equal(rows(files,'creative_exports').length,3);assert.equal(rows(files,'slides').length,1);
 for(const entry of [...manifest.datasets,...manifest.attachments]){assert.equal(files[entry.path].length,entry.size);assert.equal(createHash('sha256').update(files[entry.path]).digest('hex'),entry.sha256);}
});
function beforeSnapshotCommit(db:ReturnType<typeof openDatabase>,action:()=>void){
 const exec=db.exec.bind(db);let snapshot=false;
 db.exec=(sql:string)=>{if(sql==='BEGIN')snapshot=true;if(sql==='COMMIT'&&snapshot){snapshot=false;action();}return exec(sql);};
}
test('logout committed by another connection before publish fences the archive and cleans it',async t=>{
 const {db,dir,a,ask}=await fixture(t,true),other=openDatabase(join(dir,'fixture.sqlite'));t.after(()=>other.close());const j=await ask();
 beforeSnapshotCommit(db,()=>logout(other,a.session.token));runPersonalExportOnce(db,dir);
 assert.equal(db.prepare('SELECT 1 FROM personal_exports WHERE id=?').get(j.id),undefined);assert.equal(readdirSync(join(dir,'personal-exports')).length,0);
});
test('a reclaimed lease cannot be overwritten by the old worker',async t=>{
 const {db,dir,ask}=await fixture(t,true),other=openDatabase(join(dir,'fixture.sqlite'));t.after(()=>other.close());const j=await ask(),lease='c'.repeat(64);
 beforeSnapshotCommit(db,()=>other.prepare('UPDATE personal_exports SET lease_token=?,file_key=? WHERE id=?').run(lease,lease+'.tar',j.id));
 runPersonalExportOnce(db,dir);const row=db.prepare('SELECT state,lease_token FROM personal_exports WHERE id=?').get(j.id)!;
 assert.equal(row.state,'running');assert.equal(row.lease_token,lease);assert.equal(readdirSync(join(dir,'personal-exports')).length,0);
});
test('account deletion cascades completed exports and queues physical file deletion',async t=>{
 const {db,dir,a,ask}=await fixture(t);await ask();runPersonalExportOnce(db,dir);db.prepare('DELETE FROM users WHERE id=?').run(a.user.id);
 assert.equal(db.prepare('SELECT count(*) AS n FROM personal_export_deletions').get()!.n,1);cleanupPersonalExports(db,dir);assert.equal(readdirSync(join(dir,'personal-exports')).length,0);
});
test('download detects file substitution and refuses a symlink',async t=>{
 const {db,dir,a,ask}=await fixture(t),j=await ask();runPersonalExportOnce(db,dir);const key=db.prepare('SELECT file_key FROM personal_exports').get()!.file_key as string,path=join(dir,'personal-exports',key);
 rmSync(path);symlinkSync(join(dir,'unrelated'),path);assert.throws(()=>downloadPersonalExport(db,dir,a.user.id,a.session.token,j.id),{code:'EXPORT_UNAVAILABLE'});
});
test('cleanup IO failure is reported without killing the worker and remains retryable',async t=>{
 const {db,dir,a,ask}=await fixture(t),j=await ask();runPersonalExportOnce(db,dir);deletePersonalExport(db,a.user.id,a.session.token,j.id);
 const root=join(dir,'personal-exports');chmodSync(root,0);
 try{assert.equal(cleanupPersonalExports(db,dir).scanError,'EACCES');}finally{chmodSync(root,0o700);}
 assert.equal(cleanupPersonalExports(db,dir).removed,1);
});
test('failed deletion tombstones do not starve later valid files',async t=>{
 const {db,dir}=await fixture(t),root=join(dir,'personal-exports');mkdirSync(root);
 for(let i=0;i<=100;i++){
  const key=i.toString(16).padStart(64,'0')+'.tar';db.prepare('INSERT INTO personal_export_deletions(file_key,queued_at) VALUES(?,?)').run(key,i);
  if(i<100)mkdirSync(join(root,key));else writeFileSync(join(root,key),'delete me');
 }
 assert.equal(cleanupPersonalExports(db,dir).failed,100);assert.equal(cleanupPersonalExports(db,dir).removed,1);
});
