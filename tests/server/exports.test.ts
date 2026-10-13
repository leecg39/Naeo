import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {addSlide,createProject,deleteProject,getProject} from '../../src/server/creative/projects';
import {startExport,addPage,completeExport,readExportFile,listExports,cleanupExports,COLLECT_TTL,KEEP_TTL} from '../../src/server/creative/exports';
import {solidPng} from './helpers/png-fixture';

const NOW=Date.parse('2026-10-14T03:00:00Z');
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const dir=mkdtempSync(join(tmpdir(),'naeo-export-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const mk=async(e:string)=>(await register(db,{email:e,password:'export-long-password',nickname:e[0],termsAccepted:true})).user.id;
 const a=await mk('a@example.test'),b=await mk('b@example.test');
 const p=createProject(db,a,{kind:'ad',title:'광고 내보내기'},NOW);addSlide(db,a,p.id,{heading:'둘째'},NOW);
 return{db,dir,a,b,p};
}
const files=(dir:string)=>{try{return readdirSync(join(dir,'exports')).length;}catch{return 0;}};

test('PDF export: progress, validation failures, owner-only download, page files cleaned up',async t=>{
 const {db,dir,a,b,p}=await fixture(t);
 const job=startExport(db,a,p.id,{format:'pdf'},NOW);
 assert.deepEqual([job.state,job.slideCount,job.received],['collecting',2,0]);
 assert.throws(()=>startExport(db,b,p.id,{format:'pdf'},NOW),{status:404});
 assert.equal(addPage(db,dir,a,job.id,0,solidPng(1080,1350),NOW).received,1);
 assert.throws(()=>completeExport(db,dir,a,job.id,NOW),{status:409,code:'PAGES_MISSING'});
 assert.throws(()=>addPage(db,dir,b,job.id,1,solidPng(1080,1350),NOW),{status:404});
 assert.throws(()=>addPage(db,dir,a,job.id,5,solidPng(1080,1350),NOW),{status:400,code:'BAD_POSITION'});
 addPage(db,dir,a,job.id,1,solidPng(1080,1350),NOW);
 const done=completeExport(db,dir,a,job.id,NOW+1000);
 assert.equal(done.state,'succeeded');assert.ok(done.fileSize!>1000);
 const file=readExportFile(db,dir,a,job.id,NOW+2000);
 assert.equal(file.mime,'application/pdf');assert.equal(file.filename,'광고 내보내기.pdf');
 assert.ok(file.bytes.subarray(0,8).toString('latin1').startsWith('%PDF-1.4'));
 assert.equal((file.bytes.toString('latin1').match(/\/Type \/Page\b/g)??[]).length,2);
 assert.throws(()=>readExportFile(db,dir,b,job.id,NOW),{status:404});
 assert.equal(files(dir),1,'only the finished PDF is kept');
 assert.equal(listExports(db,a,p.id)[0].state,'succeeded');
 assert.throws(()=>readExportFile(db,dir,a,job.id,NOW+1000+KEEP_TTL),{status:410,code:'EXPORT_EXPIRED'});
});

test('bad files fail the job with a reason; ZIP export; expired work is cleaned up',async t=>{
 const {db,dir,a,p}=await fixture(t);
 const bad=startExport(db,a,p.id,{format:'zip'},NOW);
 assert.throws(()=>addPage(db,dir,a,bad.id,0,Buffer.from('<svg/>'),NOW),{code:'INVALID_PNG'});
 assert.equal(listExports(db,a,p.id).find(j=>j.id===bad.id)!.state,'failed');
 assert.match(listExports(db,a,p.id).find(j=>j.id===bad.id)!.error,/PNG/);
 const wrong=startExport(db,a,p.id,{format:'zip'},NOW);
 assert.throws(()=>addPage(db,dir,a,wrong.id,0,solidPng(1080,1440),NOW),{code:'SIZE_MISMATCH'});
 const zip=startExport(db,a,p.id,{format:'zip'},NOW);
 addPage(db,dir,a,zip.id,0,solidPng(1080,1350),NOW);addPage(db,dir,a,zip.id,1,solidPng(1080,1350,[0,0,0,255]),NOW);
 completeExport(db,dir,a,zip.id,NOW);
 const f=readExportFile(db,dir,a,zip.id,NOW);
 assert.equal(f.mime,'application/zip');assert.equal(f.bytes.readUInt32LE(0),0x04034b50);assert.ok(f.bytes.includes(Buffer.from('slide-02.png')));
 const stale=startExport(db,a,p.id,{format:'pdf'},NOW);addPage(db,dir,a,stale.id,0,solidPng(1080,1350),NOW);
 assert.throws(()=>addPage(db,dir,a,stale.id,1,solidPng(1080,1350),NOW+COLLECT_TTL+1),{status:409,code:'EXPORT_EXPIRED'});
 const removed=cleanupExports(db,dir,NOW+KEEP_TTL+1);
 assert.ok(removed>=2);assert.equal(files(dir),0,'expired files are deleted');
});

test('files of deleted projects (cascade) are swept once they are old enough',async t=>{
 const {db,dir,a,p}=await fixture(t);
 const job=startExport(db,a,p.id,{format:'pdf'},NOW);
 addPage(db,dir,a,job.id,0,solidPng(1080,1350),NOW);addPage(db,dir,a,job.id,1,solidPng(1080,1350),NOW);
 completeExport(db,dir,a,job.id,NOW);
 assert.equal(files(dir),1);
 deleteProject(db,a,p.id,{version:getProject(db,a,p.id).version});
 cleanupExports(db,dir,Date.now());
 assert.equal(files(dir),1,'fresh files are left alone (an upload may still be in flight)');
 cleanupExports(db,dir,Date.now()+2*COLLECT_TTL+1);
 assert.equal(files(dir),0,'orphaned export file removed');
});
