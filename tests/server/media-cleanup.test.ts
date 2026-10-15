import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,transaction} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {deleteAccount,eraseAccount} from '../../src/server/account-security';
import {saveUpload,deleteMedia} from '../../src/server/writing/media';
import {cleanupMedia} from '../../src/server/writing/media-cleanup';
import {serviceHealth} from '../../src/server/ops/health';

const password='cleanup-test-password',PNG=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
async function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'naeo-cleanup-')),dbFile=join(dir,'db.sqlite'),uploads=join(dir,'uploads');
 let db=openDatabase(dbFile);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const {user}=await register(db,{email:'cleanup@example.test',password,nickname:'Cleanup',termsAccepted:true});
 const photo=saveUpload(db,uploads,user.id,{bytes:PNG,name:'private.png',type:'image/png'});
 const key=db.prepare('SELECT storage_key AS k FROM media_files WHERE public_id=?').get(photo.publicId)!.k as string;
 return{db,user,photo,key,uploads,path:join(uploads,key),reopen:()=>{db.close();db=openDatabase(dbFile);return db;}};
}

test('account cascade deletion schedules physical photo removal across a database restart',async t=>{
 const f=await fixture(t);
 await deleteAccount(f.db,f.user.id,{currentPassword:password,confirmEmail:f.user.email,version:f.user.version});
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM media_files').get()?.n,0);
 const db=f.reopen();cleanupMedia(db,f.uploads);
 assert.equal(existsSync(f.path),false,'deleted member photo must not remain on disk');
 assert.equal(db.prepare('SELECT count(*) AS n FROM media_deletions').get()?.n,0);
});

test('rollback preserves both the owner and photo without scheduling deletion',async t=>{
 const f=await fixture(t);
 assert.throws(()=>transaction(f.db,()=>{eraseAccount(f.db,f.user.id,f.user.id);throw new Error('rollback');}),/rollback/);
 cleanupMedia(f.db,f.uploads);
 assert.deepEqual(readFileSync(f.path),PNG);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM media_deletions').get()?.n,0);
});

test('failed physical deletion remains retryable after restart and never deletes a referenced photo',async t=>{
 const f=await fixture(t);
 rmSync(f.path);mkdirSync(f.path);
 assert.doesNotThrow(()=>deleteMedia(f.db,f.uploads,f.user.id,f.photo.publicId));
 const db=f.reopen();
 const failed=db.prepare('SELECT attempts,last_error_code FROM media_deletions').get();
 assert.ok(Number(failed?.attempts)>0);assert.match(String(failed?.last_error_code),/^(EISDIR|EPERM)$/);
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(f.user.id);
 assert.deepEqual(serviceHealth(db,f.user.id).mediaDeletion,{pending:1,retrying:1});
 rmSync(f.path,{recursive:true});writeFileSync(f.path,PNG);
 assert.equal(cleanupMedia(db,f.uploads).removed,1);
 assert.equal(existsSync(f.path),false);
 const live=saveUpload(db,f.uploads,f.user.id,{bytes:PNG,name:'live.png',type:'image/png'});
 const key=db.prepare('SELECT storage_key AS k FROM media_files WHERE public_id=?').get(live.publicId)!.k as string;
 db.prepare('INSERT INTO media_deletions(storage_key) VALUES(?)').run(key);
 cleanupMedia(db,f.uploads);
 assert.equal(existsSync(join(f.uploads,key)),true,'a referenced file is never removed');
});

test('restoring the missing media cleanup migration preserves photos and cascading deletion recovery',async t=>{
 const f=await fixture(t);
 f.db.exec('DROP TRIGGER media_delete_file; DROP TABLE media_deletions; DELETE FROM schema_migrations WHERE version=26;');
 const db=f.reopen();
 assert.equal(db.prepare('SELECT version AS v FROM schema_migrations WHERE version=26').get()?.v,26);
 assert.equal(db.prepare('SELECT count(*) AS n FROM media_files').get()?.n,1);
 assert.deepEqual(readFileSync(f.path),PNG);
 transaction(db,()=>eraseAccount(db,f.user.id,f.user.id));
 assert.equal(db.prepare('SELECT count(*) AS n FROM media_deletions').get()?.n,1);
 cleanupMedia(db,f.uploads);assert.equal(existsSync(f.path),false);
});

test('malformed deletion keys cannot remove a file outside the upload root',async t=>{
 const f=await fixture(t),outside=join(f.uploads,'..','protected.txt');writeFileSync(outside,'preserve');
 f.db.prepare('INSERT INTO media_deletions(storage_key) VALUES(?)').run('../protected.txt');
 assert.equal(cleanupMedia(f.db,f.uploads).failed,1);
 assert.equal(readFileSync(outside,'utf8'),'preserve');
 assert.equal(f.db.prepare('SELECT last_error_code FROM media_deletions').get()?.last_error_code,'INVALID_STORAGE_KEY');
});

test('orphan recovery removes only old recognized files, preserving active, recent and unrelated files',async t=>{
 const f=await fixture(t),now=Date.now(),old=new Date(now-2*60*60_000);
 const orphan=join(f.uploads,`${randomUUID()}.png`),recent=join(f.uploads,`${randomUUID()}.png`),unrelated=join(f.uploads,'private-notes.txt');
 for(const p of [orphan,recent,unrelated])writeFileSync(p,PNG);
 for(const p of [f.path,orphan,unrelated])utimesSync(p,old,old);
 cleanupMedia(f.db,f.uploads,now);
 assert.equal(existsSync(orphan),false);
 for(const p of [f.path,recent,unrelated])assert.equal(existsSync(p),true);
});
