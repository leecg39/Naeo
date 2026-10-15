import {migrations} from '../../src/server/migrations';
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync,symlinkSync,renameSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBackup,restoreBackup,verifyBackup,recoverRestore,restoreJournalPath} from '../../src/server/ops/backup';

function dirs(t:TestContext){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'naeo-backup-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const uploads=join(root,'uploads');mkdirSync(join(uploads,'exports'),{recursive:true});writeFileSync(join(uploads,'photo.png'),'png-bytes');writeFileSync(join(uploads,'exports','a.pdf'),'pdf-bytes');
 return{root,uploads,dbPath:join(root,'live.sqlite')};
}

test('backup: open connection without concurrent writers, uploads copy, manifest with checksums and counts',async t=>{
 const {root,uploads,dbPath}=dirs(t);
 const db=openDatabase(dbPath);t.after(()=>db.close());
 await register(db,{email:'b@example.test',password:'backup-long-password',nickname:'B',termsAccepted:true});
 const out=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')},Date.parse('2026-10-14T03:00:00Z'));
 assert.match(out.dir,/naeo-2026-10-14T03-00-00Z$/);
 const manifest=JSON.parse(readFileSync(join(out.dir,'manifest.json'),'utf8'));
 assert.equal(manifest.schemaVersion,migrations.at(-1)!.version);assert.equal(manifest.counts.users,1);assert.equal(manifest.files,2);
 assert.ok(existsSync(join(out.dir,'uploads','exports','a.pdf')));
 assert.deepEqual(verifyBackup(out.dir).ok,true);
 writeFileSync(join(out.dir,'db.sqlite'),'tampered');
 assert.throws(()=>verifyBackup(out.dir),{code:'BACKUP_CORRUPT'});
});

test('backup rejects changed, missing and extra upload files',t=>{
 const {root,uploads,dbPath}=dirs(t),db=openDatabase(dbPath);t.after(()=>db.close());
 const {dir}=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')});
 const photo=join(dir,'uploads','photo.png');writeFileSync(photo,'bad-bytes');
 assert.throws(()=>verifyBackup(dir),{code:'BACKUP_CORRUPT'});
 writeFileSync(photo,'png-bytes');rmSync(photo);
 assert.throws(()=>verifyBackup(dir),{code:'BACKUP_CORRUPT'});
 writeFileSync(photo,'png-bytes');writeFileSync(join(dir,'uploads','extra'),'unexpected');
 assert.throws(()=>verifyBackup(dir),{code:'BACKUP_CORRUPT'});
});

test('backup rejects upload symlinks and overlapping source/destination',t=>{
 const {root,uploads,dbPath}=dirs(t),db=openDatabase(dbPath);t.after(()=>db.close());
 assert.throws(()=>createBackup(db,{uploadsDir:uploads,destDir:join(uploads,'backups')}),{code:'UNSAFE_BACKUP_PATH'});
 symlinkSync(dbPath,join(uploads,'db-link'));
 assert.throws(()=>createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')}),{code:'UNSAFE_BACKUP_PATH'});
});

test('restore refuses uploads-only target without force',t=>{
 const {root,uploads,dbPath}=dirs(t),db=openDatabase(dbPath);t.after(()=>db.close());
 const {dir}=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')});
 assert.throws(()=>restoreBackup(dir,{dbPath:join(root,'new.sqlite'),uploadsDir:uploads}),{code:'TARGET_EXISTS'});
 assert.equal(readFileSync(join(uploads,'photo.png'),'utf8'),'png-bytes');
});

test('restore validates SQLite and migration checksums before moving live files',t=>{
 const {root,uploads,dbPath}=dirs(t),db=openDatabase(dbPath);
 const {dir}=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')});db.close();
 const before=readFileSync(dbPath),file=join(dir,'db.sqlite');
 const bad=new DatabaseSync(file);bad.exec("UPDATE schema_migrations SET checksum='wrong' WHERE version=1");bad.close();
 const manifestPath=join(dir,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 manifest.sha256=createHash('sha256').update(readFileSync(file)).digest('hex');writeFileSync(manifestPath,JSON.stringify(manifest));
 assert.throws(()=>restoreBackup(dir,{dbPath,uploadsDir:uploads,force:true}),{code:'BACKUP_CORRUPT'});
 assert.deepEqual(readFileSync(dbPath),before);assert.equal(readFileSync(join(uploads,'photo.png'),'utf8'),'png-bytes');
 assert.equal(readdirSync(root).some(n=>n.includes('before-restore')),false);
});

test('restore never overwrites a previous recovery copy or accepts overlapping targets',t=>{
 const {root,uploads,dbPath}=dirs(t),db=openDatabase(dbPath);
 const {dir}=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')});db.close();
 const now=Date.parse('2026-10-15T00:00:00Z'),previous=dbPath+'.before-restore-2026-10-15T00-00-00Z';writeFileSync(previous,'keep this');
 assert.throws(()=>restoreBackup(dir,{dbPath,uploadsDir:uploads,force:true},now),{code:'RESTORE_COLLISION'});
 assert.equal(readFileSync(previous,'utf8'),'keep this');
 assert.throws(()=>restoreBackup(dir,{dbPath:join(uploads,'db.sqlite'),uploadsDir:uploads,force:true}),{code:'UNSAFE_BACKUP_PATH'});
 assert.throws(()=>restoreBackup(dir,{dbPath:join(dir,'live.sqlite'),uploadsDir:join(root,'new-uploads'),force:true}),{code:'UNSAFE_BACKUP_PATH'});
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

test('restore rolls back both resources when installing uploads fails after DB replacement',async t=>{
 const {root,uploads,dbPath}=dirs(t),db=openDatabase(dbPath);
 await register(db,{email:'original@example.test',password:'restore-long-password',nickname:'R',termsAccepted:true});
 const {dir}=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')});
 await register(db,{email:'later@example.test',password:'restore-long-password',nickname:'L',termsAccepted:true});db.close();
 writeFileSync(join(uploads,'photo.png'),'later-photo');
 const before=readFileSync(dbPath);
 assert.throws(()=>restoreBackup(dir,{dbPath,uploadsDir:uploads,force:true},Date.now(),{rename(from,to){
  if(String(from).includes('.naeo-uploads-')&&String(to)===uploads)throw new Error('injected disk failure');
  renameSync(from,to);
 }}),/injected disk failure/);
 assert.deepEqual(readFileSync(dbPath),before);assert.equal(readFileSync(join(uploads,'photo.png'),'utf8'),'later-photo');
 assert.equal(existsSync(restoreJournalPath(dbPath)),false);
 assert.equal(readdirSync(root).some(n=>n.startsWith('.naeo-')),false);
});

test('restore crash blocks database startup and the real recovery CLI restores the original pair',async t=>{
 const {root,uploads,dbPath}=dirs(t),db=openDatabase(dbPath);
 await register(db,{email:'original@example.test',password:'restore-long-password',nickname:'R',termsAccepted:true});
 const {dir}=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')});
 await register(db,{email:'later@example.test',password:'restore-long-password',nickname:'L',termsAccepted:true});db.close();
 writeFileSync(join(uploads,'photo.png'),'later-photo');const before=readFileSync(dbPath);
 const moduleUrl=pathToFileURL(resolve('src/server/ops/backup.ts')).href;
 const script=`import {restoreBackup} from ${JSON.stringify(moduleUrl)};import {renameSync} from 'node:fs';
 restoreBackup(${JSON.stringify(dir)},{dbPath:${JSON.stringify(dbPath)},uploadsDir:${JSON.stringify(uploads)},force:true},Date.now(),{rename(a,b){renameSync(a,b);if(String(a).endsWith('/db.sqlite')&&String(b)===${JSON.stringify(dbPath)})process.kill(process.pid,'SIGKILL');}});`;
 const killed=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(killed.signal,'SIGKILL',killed.stderr);assert.ok(existsSync(restoreJournalPath(dbPath)));
 assert.throws(()=>openDatabase(dbPath),/Restore recovery is required/);
 const journalFile=restoreJournalPath(dbPath),journalBytes=readFileSync(journalFile),journal=JSON.parse(journalBytes.toString());
 journal.ownerPid=process.ppid;writeFileSync(journalFile,JSON.stringify(journal));
 assert.throws(()=>recoverRestore(dbPath),{code:'RESTORE_IN_PROGRESS'});
 journal.ownerPid=JSON.parse(journalBytes.toString()).ownerPid;journal.entries[0].previous=join(root,'unrelated-file');writeFileSync(journalFile,JSON.stringify(journal));
 assert.throws(()=>recoverRestore(dbPath),{code:'RESTORE_RECOVERY_REQUIRED'});
 writeFileSync(journalFile,journalBytes);
 const originalJournal=JSON.parse(journalBytes.toString()),preservedDb=originalJournal.entries[0].previous;
 writeFileSync(preservedDb,'damaged recovery copy');
 assert.throws(()=>recoverRestore(dbPath),{code:'RESTORE_RECOVERY_REQUIRED'});assert.ok(existsSync(journalFile));
 writeFileSync(preservedDb,before);
 const cli=spawnSync(process.execPath,['--import','tsx','scripts/restore.ts','--offline','--recover'],{cwd:process.cwd(),env:{...process.env,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:uploads},encoding:'utf8'});
 assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).action,'rolled-back');
 assert.deepEqual(readFileSync(dbPath),before);assert.equal(readFileSync(join(uploads,'photo.png'),'utf8'),'later-photo');
 const reopened=openDatabase(dbPath);assert.equal(reopened.prepare('SELECT count(*) AS n FROM users').get()?.n,2);reopened.close();
 assert.deepEqual(recoverRestore(dbPath),{recovered:false});
});

test('a committed recovery journal keeps installed data and only removes staging state',async t=>{
 const {root,uploads,dbPath}=dirs(t),db=openDatabase(dbPath);
 await register(db,{email:'old@example.test',password:'restore-long-password',nickname:'O',termsAccepted:true});
 const {dir}=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')});
 await register(db,{email:'later@example.test',password:'restore-long-password',nickname:'L',termsAccepted:true});db.close();writeFileSync(join(uploads,'photo.png'),'later-photo');
 const moduleUrl=pathToFileURL(resolve('src/server/ops/backup.ts')).href;
 const script=`import {restoreBackup} from ${JSON.stringify(moduleUrl)};import {renameSync} from 'node:fs';
 restoreBackup(${JSON.stringify(dir)},{dbPath:${JSON.stringify(dbPath)},uploadsDir:${JSON.stringify(uploads)},force:true},Date.now(),{rename(a,b){renameSync(a,b);if(String(a).includes('.naeo-uploads-')&&String(b)===${JSON.stringify(uploads)})process.kill(process.pid,'SIGKILL');}});`;
 const killed=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{encoding:'utf8'});assert.equal(killed.signal,'SIGKILL',killed.stderr);
 // Both real renames have completed. Model the persisted commit marker before cleanup.
 const file=restoreJournalPath(dbPath),journal=JSON.parse(readFileSync(file,'utf8'));journal.phase='committed';writeFileSync(file,JSON.stringify(journal));
 assert.equal(recoverRestore(dbPath).action,'finalized');assert.equal(readFileSync(join(uploads,'photo.png'),'utf8'),'png-bytes');
 assert.equal(readFileSync(join(journal.entries[3].previous,'photo.png'),'utf8'),'later-photo');
 const restored=openDatabase(dbPath);assert.equal(restored.prepare('SELECT count(*) AS n FROM users').get()?.n,1);restored.close();
 assert.equal(existsSync(journal.stage),false);assert.equal(existsSync(journal.uploadsStage),false);
});

test('rollback removes a partially installed new target when no previous data existed',t=>{
 const {root,uploads,dbPath}=dirs(t),db=openDatabase(dbPath);
 const {dir}=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')});db.close();
 const targetDb=join(root,'new','db.sqlite'),targetUploads=join(root,'separate','uploads');
 assert.throws(()=>restoreBackup(dir,{dbPath:targetDb,uploadsDir:targetUploads},Date.now(),{rename(from,to){
  if(String(from).includes('.naeo-uploads-'))throw new Error('upload install failed');renameSync(from,to);
 }}),/upload install failed/);
 assert.equal(existsSync(targetDb),false);assert.equal(existsSync(targetUploads),false);assert.equal(existsSync(restoreJournalPath(targetDb)),false);
});

test('backup verification checks foreign keys and counts even when a modified DB has a valid hash',async t=>{
 const {root,uploads,dbPath}=dirs(t),db=openDatabase(dbPath);
 await register(db,{email:'integrity@example.test',password:'restore-long-password',nickname:'I',termsAccepted:true});
 const {dir}=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')});db.close();
 const file=join(dir,'db.sqlite'),manifestPath=join(dir,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 manifest.counts.users=999;writeFileSync(manifestPath,JSON.stringify(manifest));assert.throws(()=>verifyBackup(dir),{code:'BACKUP_CORRUPT'});
 manifest.counts.users=1;
 const edited=new DatabaseSync(file);edited.exec("PRAGMA foreign_keys=OFF;UPDATE profiles SET user_id='orphan'");edited.close();
 manifest.sha256=createHash('sha256').update(readFileSync(file)).digest('hex');writeFileSync(manifestPath,JSON.stringify(manifest));
 assert.throws(()=>verifyBackup(dir),{code:'BACKUP_CORRUPT'});
 writeFileSync(file,'not a sqlite file');manifest.sha256=createHash('sha256').update(readFileSync(file)).digest('hex');writeFileSync(manifestPath,JSON.stringify(manifest));
 assert.throws(()=>verifyBackup(dir),{code:'BACKUP_CORRUPT'});
});

test('real backup/restore CLIs require offline acknowledgement and restore a fresh destination',t=>{
 const {root,uploads,dbPath}=dirs(t),dest=join(root,'backups');
 const env={...process.env,NAEO_DATABASE_PATH:dbPath,NAEO_UPLOAD_DIR:uploads};
 const rejected=spawnSync(process.execPath,['--import','tsx','scripts/backup.ts',dest],{env,encoding:'utf8'});
 assert.equal(rejected.status,1);assert.equal(existsSync(dbPath),false);
 const missing=spawnSync(process.execPath,['--import','tsx','scripts/backup.ts',dest,'--offline'],{env,encoding:'utf8'});
 assert.equal(missing.status,1);assert.equal(existsSync(dbPath),false);
 const source=openDatabase(dbPath);source.close();
 const backup=spawnSync(process.execPath,['--import','tsx','scripts/backup.ts',dest,'--offline'],{env,encoding:'utf8'});
 assert.equal(backup.status,0,backup.stderr);
 const backupDir=join(dest,readdirSync(dest)[0]),targetDb=join(root,'restored','db.sqlite'),targetUploads=join(root,'restored-media');
 const restored=spawnSync(process.execPath,['--import','tsx','scripts/restore.ts',backupDir,'--offline'],{env:{...env,NAEO_DATABASE_PATH:targetDb,NAEO_UPLOAD_DIR:targetUploads},encoding:'utf8'});
 assert.equal(restored.status,0,restored.stderr);assert.equal(readFileSync(join(targetUploads,'photo.png'),'utf8'),'png-bytes');
 const checked=openDatabase(targetDb);assert.equal(checked.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n,migrations.length);checked.close();
});

test('staged migration failure preserves existing DB and uploads',t=>{
 const {root,uploads,dbPath}=dirs(t),live=openDatabase(dbPath);live.close();const before=readFileSync(dbPath);
 const old=new DatabaseSync(join(root,'old.sqlite'));
 old.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,checksum TEXT,applied_at INTEGER);');
 old.exec(migrations[0].sql);old.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(1,migrations[0].name,createHash('sha256').update(migrations[0].sql).digest('hex'),Date.now());
 old.exec('ALTER TABLE users ADD COLUMN version INTEGER;');
 const {dir}=createBackup(old,{uploadsDir:uploads,destDir:join(root,'backups')});old.close();
 assert.throws(()=>restoreBackup(dir,{dbPath,uploadsDir:uploads,force:true}),/duplicate column name/);
 assert.deepEqual(readFileSync(dbPath),before);assert.equal(readFileSync(join(uploads,'photo.png'),'utf8'),'png-bytes');
 assert.equal(existsSync(restoreJournalPath(dbPath)),false);
});

test('malformed manifest, legacy checksum-only format and extra root entries fail closed',t=>{
 const {root,uploads,dbPath}=dirs(t),db=openDatabase(dbPath);t.after(()=>db.close());
 const {dir}=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')});
 const file=join(dir,'manifest.json'),original=readFileSync(file);
 writeFileSync(file,'{');assert.throws(()=>verifyBackup(dir),{code:'BACKUP_CORRUPT'});
 writeFileSync(file,JSON.stringify({sha256:'a'.repeat(64)}));assert.throws(()=>verifyBackup(dir),{code:'BACKUP_FORMAT_UNSUPPORTED'});
 writeFileSync(file,original);symlinkSync(dbPath,join(dir,'outside-link'));
 assert.throws(()=>verifyBackup(dir),{code:'BACKUP_CORRUPT'});
});

test('legacy backups with no uploads remain restorable without changing the source',t=>{
 const {root,uploads,dbPath}=dirs(t);rmSync(uploads,{recursive:true});
 const db=openDatabase(dbPath),{dir,manifest}=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')});db.close();
 const file=join(dir,'manifest.json');
 writeFileSync(file,JSON.stringify({createdAt:manifest.createdAt,schemaVersion:manifest.schemaVersion,counts:manifest.counts,files:0,sha256:manifest.sha256}));
 const before=readFileSync(file);assert.equal(verifyBackup(dir).legacyEmpty,true);
 const target=join(root,'legacy-restored.sqlite');restoreBackup(dir,{dbPath:target,uploadsDir:join(root,'legacy-uploads')});
 assert.deepEqual(readFileSync(file),before);
 const restored=openDatabase(target);assert.equal(restored.prepare('SELECT max(version) AS v FROM schema_migrations').get()?.v,migrations.at(-1)!.version);restored.close();
 // A legacy claim of zero files is not sufficient when there are actual upload bytes.
 mkdirSync(join(dir,'uploads'));writeFileSync(join(dir,'uploads','unexpected'),'bytes');assert.throws(()=>verifyBackup(dir),{code:'BACKUP_CORRUPT'});
});

test('read-only verification of a WAL-mode snapshot never creates sidecars',t=>{
 const {root,uploads,dbPath}=dirs(t),db=openDatabase(dbPath),{dir}=createBackup(db,{uploadsDir:uploads,destDir:join(root,'backups')});db.close();
 const file=join(dir,'db.sqlite'),snapshot=new DatabaseSync(file);snapshot.exec('PRAGMA journal_mode=WAL;');snapshot.close();
 const manifestPath=join(dir,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));manifest.sha256=createHash('sha256').update(readFileSync(file)).digest('hex');writeFileSync(manifestPath,JSON.stringify(manifest));
 const before=readdirSync(dir).sort();assert.equal(verifyBackup(dir).ok,true);assert.equal(verifyBackup(dir).ok,true);
 assert.deepEqual(readdirSync(dir).sort(),before);assert.equal(existsSync(file+'-wal'),false);assert.equal(existsSync(file+'-shm'),false);
});
