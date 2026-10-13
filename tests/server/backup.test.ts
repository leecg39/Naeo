import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBackup,restoreBackup,verifyBackup} from '../../src/server/ops/backup';

function dirs(t:TestContext){
 const root=mkdtempSync(join(tmpdir(),'naeo-backup-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const uploads=join(root,'uploads');mkdirSync(join(uploads,'exports'),{recursive:true});writeFileSync(join(uploads,'photo.png'),'png-bytes');writeFileSync(join(uploads,'exports','a.pdf'),'pdf-bytes');
 return{root,uploads,dbPath:join(root,'live.sqlite')};
}

test('backup: consistent DB snapshot while open, uploads copy, manifest with checksum and counts',async t=>{
 const {root,uploads,dbPath}=dirs(t);
 const db=openDatabase(dbPath);t.after(()=>db.close());
 await register(db,{email:'b@example.test',password:'backup-long-password',nickname:'B',termsAccepted:true});
 const out=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')},Date.parse('2026-10-14T03:00:00Z'));
 assert.match(out.dir,/naeo-2026-10-14T03-00-00Z$/);
 const manifest=JSON.parse(readFileSync(join(out.dir,'manifest.json'),'utf8'));
 assert.equal(manifest.schemaVersion,26);assert.equal(manifest.counts.users,1);assert.equal(manifest.files,2);
 assert.ok(existsSync(join(out.dir,'uploads','exports','a.pdf')));
 assert.deepEqual(verifyBackup(out.dir).ok,true);
 writeFileSync(join(out.dir,'db.sqlite'),'tampered');
 assert.throws(()=>verifyBackup(out.dir),{code:'BACKUP_CORRUPT'});
});

test('restore: refuses to overwrite without force, keeps the previous data, reopens and matches counts',async t=>{
 const {root,uploads,dbPath}=dirs(t);
 const db=openDatabase(dbPath);
 await register(db,{email:'r@example.test',password:'restore-long-password',nickname:'R',termsAccepted:true});
 const out=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')},Date.parse('2026-10-14T03:00:00Z'));
 await register(db,{email:'later@example.test',password:'restore-long-password',nickname:'L',termsAccepted:true});
 db.close();
 assert.throws(()=>restoreBackup(out.dir,{dbPath,uploadsDir:uploads}),{code:'TARGET_EXISTS'});
 const done=restoreBackup(out.dir,{dbPath,uploadsDir:uploads,force:true},Date.parse('2026-10-14T04:00:00Z'));
 assert.equal(done.counts.users,1,'the account created after the backup is gone');
 assert.ok(existsSync(done.previousDb!),'previous database kept aside');
 assert.ok(readdirSync(root).some(n=>n.startsWith('uploads.before-restore-')),'previous uploads kept aside');
 assert.equal(readFileSync(join(uploads,'photo.png'),'utf8'),'png-bytes');
 const reopened=openDatabase(dbPath);t.after(()=>reopened.close());
 assert.equal((reopened.prepare('SELECT count(*) AS n FROM users').get() as {n:number}).n,1);
});
