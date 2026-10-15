import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {closeSync,cpSync,fsyncSync,linkSync,lstatSync,mkdirSync,mkdtempSync,openSync,readSync,readdirSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,relative,resolve,sep} from 'node:path';
import {z} from 'zod';
import {openDatabase,type Database} from '../database';
import {migrations} from '../migrations';
import {AppError} from '../errors';

const digest=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative().safe();
const manifestSchema=z.object({formatVersion:z.literal(2),createdAt:z.iso.datetime(),schemaVersion:count,
 counts:z.record(z.string(),count),files:count,sha256:digest,uploadsPresent:z.boolean(),
 uploads:z.array(z.object({path:z.string(),bytes:count,sha256:digest}).strict())}).strict();
export type Manifest=z.infer<typeof manifestSchema>;
const stamp=(ms:number)=>new Date(ms).toISOString().replace(/\.\d{3}Z$/,'Z').replace(/:/g,'-');
const corrupt=()=>new AppError(400,'BACKUP_CORRUPT','백업 파일·목록·DB 무결성 또는 마이그레이션 기록이 일치하지 않습니다.');
const unsafe=()=>new AppError(400,'UNSAFE_BACKUP_PATH','백업·DB·업로드 경로가 겹치거나 심볼릭 링크를 포함합니다.');
const present=(path:string)=>{try{lstatSync(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}};
// Resolve system aliases such as macOS /var, while rejecting a linked input itself.
function canonical(path:string):string{
 const p=resolve(path);
 if(present(p)){if(lstatSync(p).isSymbolicLink())throw unsafe();return realpathSync(p);}
 return join(canonical(dirname(p)),basename(p));
}
const within=(child:string,parent:string)=>child===parent||child.startsWith(parent+sep);
function separate(paths:string[]){for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++)if(within(paths[i],paths[j])||within(paths[j],paths[i]))throw unsafe();}
function sha(path:string){
 const fd=openSync(path,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);
 try{let n;while((n=readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,n));return hash.digest('hex');}finally{closeSync(fd);}
}
function inventory(dir:string,base=dir):Manifest['uploads']{
 if(!present(dir))return [];
 if(!lstatSync(dir).isDirectory()||lstatSync(dir).isSymbolicLink())throw unsafe();
 return readdirSync(dir).sort().flatMap(name=>{
  const p=join(dir,name),st=lstatSync(p);
  if(st.isSymbolicLink())throw unsafe();
  if(st.isDirectory())return inventory(p,base);
  if(!st.isFile())throw unsafe();
  return [{path:relative(base,p).split(sep).join('/'),bytes:st.size,sha256:sha(p)}];
 }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
function tableCounts(db:Database):Record<string,number>{
 const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(r=>r.name);
 return Object.fromEntries(tables.map(t=>[t,(db.prepare(`SELECT count(*) AS n FROM "${t.replace(/"/g,'""')}"`).get() as {n:number}).n]));
}
/** Read-only inspection never migrates or changes the source backup. */
function inspectDatabase(path:string){
 // A checkpointed, offline artifact has no WAL sidecars. immutable also prevents SQLite
 // from creating -wal/-shm beside a read-only connection to a WAL-mode database.
 const uri=pathToFileURL(path);uri.searchParams.set('immutable','1');
 const db=new DatabaseSync(uri.href,{readOnly:true});
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
  if(db.prepare('PRAGMA integrity_check(1)').get()?.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').get())throw corrupt();
  const installed=db.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all() as {version:number;checksum:string}[];
  if(!installed.length||installed.length>migrations.length)throw corrupt();
  for(let i=0;i<installed.length;i++)if(installed[i].version!==migrations[i].version||installed[i].checksum!==createHash('sha256').update(migrations[i].sql).digest('hex'))throw corrupt();
  return{schemaVersion:installed.at(-1)!.version,counts:tableCounts(db)};
 }finally{db.close();}
}
function syncPath(path:string){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function syncTree(path:string){if(lstatSync(path).isDirectory())for(const name of readdirSync(path))syncTree(join(path,name));syncPath(path);}
function move(from:string,to:string){renameSync(from,to);syncPath(dirname(from));if(dirname(from)!==dirname(to))syncPath(dirname(to));}
function publishJson(path:string,value:unknown,exclusive=false){
 const tmp=path+'.tmp-'+randomUUID();writeFileSync(tmp,JSON.stringify(value,null,1)+'\n',{mode:0o600,flag:'wx'});
 try{syncPath(tmp);if(exclusive){linkSync(tmp,path);rmSync(tmp);}else renameSync(tmp,path);syncPath(dirname(path));}
 finally{rmSync(tmp,{force:true});}
}

/** Offline DB+uploads backup. Stop web/worker processes; VACUUM alone cannot snapshot mutable files. */
export function createBackup(db:Database,opts:{uploadsDir:string;destDir:string},now=Date.now()){
 const uploads=canonical(opts.uploadsDir),dest=canonical(opts.destDir);
 const source=(db.prepare('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')?.file;
 if(source&&present(restoreJournalPath(canonical(source))))throw new AppError(409,'RESTORE_RECOVERY_REQUIRED','중단된 복원을 복구한 뒤 백업하세요.');
 separate([uploads,dest,...(source?[canonical(source)]:[])]);
 const files=inventory(uploads); // Fail before creating a destination for linked/special files.
 mkdirSync(dest,{recursive:true,mode:0o700});
 const dir=join(dest,`naeo-${stamp(now)}`);
 try{mkdirSync(dir,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new AppError(409,'BACKUP_EXISTS','같은 시각의 백업이 이미 있습니다.');throw e;}
 try{
  const dbFile=join(dir,'db.sqlite');db.exec(`VACUUM INTO '${dbFile.replace(/'/g,"''")}'`);
  if(present(uploads))cpSync(uploads,join(dir,'uploads'),{recursive:true,errorOnExist:true,force:false});
  const copied=inventory(join(dir,'uploads'));
  if(JSON.stringify(copied)!==JSON.stringify(files)||JSON.stringify(inventory(uploads))!==JSON.stringify(files))throw new AppError(409,'BACKUP_SOURCE_CHANGED','업로드가 백업 중 변경되었습니다. 웹 서버와 작업자를 멈춘 뒤 다시 실행하세요.');
  const manifest:Manifest={formatVersion:2,createdAt:new Date(now).toISOString(),...inspectDatabase(dbFile),files:files.length,sha256:sha(dbFile),uploadsPresent:present(uploads),uploads:copied};
  publishJson(join(dir,'manifest.json'),manifest,true);syncTree(dir);syncPath(dest);
  verifyBackup(dir);return{dir,manifest};
 }catch(e){rmSync(dir,{recursive:true,force:true});throw e;}
}

export function verifyBackup(input:string){
 try{
  const dir=canonical(input),manifestPath=join(dir,'manifest.json'),file=join(dir,'db.sqlite');
  if(readdirSync(dir).some(name=>!['manifest.json','db.sqlite','uploads'].includes(name)))throw corrupt();
  if(!lstatSync(manifestPath).isFile()||lstatSync(manifestPath).isSymbolicLink()||lstatSync(manifestPath).size>16*1024*1024)throw corrupt();
  const parsed:unknown=JSON.parse(readFileSync(manifestPath,'utf8'));
  const legacyEmpty=(parsed as {formatVersion?:number;files?:number})?.formatVersion===undefined&&(parsed as {files?:number})?.files===0;
  if(!legacyEmpty&&(parsed as {formatVersion?:number})?.formatVersion!==2)throw new AppError(400,'BACKUP_FORMAT_UNSUPPORTED','업로드가 있는 구형 백업에는 파일 체크섬이 없습니다. 원본을 보존하고 형식 2로 새 백업을 만드세요.');
  const legacySchema=manifestSchema.omit({formatVersion:true,uploadsPresent:true,uploads:true});
  const manifest=legacyEmpty?manifestSchema.parse({...legacySchema.parse(parsed),formatVersion:2,uploads:[],uploadsPresent:present(join(dir,'uploads'))}):manifestSchema.parse(parsed);
  if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()||sha(file)!==manifest.sha256||present(file+'-wal')||present(file+'-shm'))throw corrupt();
  const actual=inventory(join(dir,'uploads'));
  if(manifest.uploadsPresent!==present(join(dir,'uploads'))||manifest.files!==actual.length||JSON.stringify(actual)!==JSON.stringify(manifest.uploads))throw corrupt();
  const info=inspectDatabase(file);
  if(info.schemaVersion!==manifest.schemaVersion||JSON.stringify(info.counts)!==JSON.stringify(manifest.counts))throw corrupt();
  return{ok:true,manifest,legacyEmpty};
 }catch(e){if(e instanceof AppError&&e.code==='BACKUP_FORMAT_UNSUPPORTED')throw e;throw corrupt();}
}

const fingerprint=(path:string)=>lstatSync(path).isDirectory()?createHash('sha256').update(JSON.stringify(inventory(path))).digest('hex'):sha(path);
type Entry={target:string;previous:string;existed:boolean;beforeHash?:string;staged?:string};
type Journal={version:1;ownerPid:number;dbPath:string;stage:string;uploadsStage:string;suffix:string;phase:'prepared'|'committed';entries:Entry[]};
export const restoreJournalPath=(dbPath:string)=>resolve(dbPath)+'.restore-pending.json';

/** Run with all writers stopped. A prepared journal rolls back, a committed journal only finalizes cleanup. */
export function recoverRestore(dbPath:string){
 const path=canonical(dbPath),file=restoreJournalPath(path);
 if(!present(file))return{recovered:false};
 let journal:Journal;
 try{
  const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024)throw new Error('Invalid recovery file');
  journal=z.object({version:z.literal(1),ownerPid:z.number().int().positive().safe(),dbPath:z.string(),stage:z.string(),uploadsStage:z.string(),suffix:z.string().regex(/^\.before-restore-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ$/),phase:z.enum(['prepared','committed']),entries:z.array(z.object({target:z.string(),previous:z.string(),existed:z.boolean(),beforeHash:digest.optional(),staged:z.string().optional()}).strict()).length(4)}).strict().parse(JSON.parse(readFileSync(file,'utf8')));
  if(journal.dbPath!==path||dirname(journal.stage)!==dirname(path)||!basename(journal.stage).startsWith('.naeo-restore-')||!basename(journal.uploadsStage).startsWith('.naeo-uploads-')||dirname(journal.uploadsStage)!==dirname(journal.entries[3].target))throw new Error('Invalid staging paths');
  const expected=[path,path+'-wal',path+'-shm',journal.entries[3].target];
  for(let i=0;i<4;i++){
   const entry=journal.entries[i],staged=i===0?join(journal.stage,'db.sqlite'):i===3?join(journal.uploadsStage,'uploads'):undefined;
   if(entry.target!==canonical(entry.target)||entry.target!==expected[i]||entry.previous!==entry.target+journal.suffix||entry.staged!==staged||entry.existed!==Boolean(entry.beforeHash))throw new Error('Invalid recovery entry');
   canonical(entry.previous);
  }
  separate([path,journal.entries[3].target,journal.stage,journal.uploadsStage]);
 }catch{throw new AppError(409,'RESTORE_RECOVERY_REQUIRED','복원 기록을 확인해야 합니다. 기록과 보존 사본을 삭제하지 마세요.');}
 if(journal.ownerPid!==process.pid){
  let running=true;try{process.kill(journal.ownerPid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')running=false;}
  if(running)throw new AppError(409,'RESTORE_IN_PROGRESS','복원 프로세스가 실행 중입니다. 종료 여부를 확인한 뒤 복구하세요.');
 }
 if(journal.phase==='prepared'){
  for(const entry of journal.entries)if(entry.existed){
   const original=present(entry.previous)?entry.previous:entry.target;
   if(!present(original)||fingerprint(original)!==entry.beforeHash)throw new AppError(409,'RESTORE_RECOVERY_REQUIRED','보존 사본이 없거나 변경되었습니다. 복원 기록과 남은 사본을 유지하고 운영자가 확인해야 합니다.');
  }
  for(const entry of [...journal.entries].reverse()){
   if(entry.existed&&present(entry.previous)){
    rmSync(entry.target,{recursive:true,force:true});move(entry.previous,entry.target);
   }else if(!entry.existed&&entry.staged&&!present(entry.staged)){
    rmSync(entry.target,{recursive:true,force:true});syncPath(dirname(entry.target));
   }
  }
 }
 rmSync(journal.stage,{recursive:true,force:true});rmSync(journal.uploadsStage,{recursive:true,force:true});rmSync(file);syncPath(dirname(file));
 return{recovered:true,action:journal.phase==='prepared'?'rolled-back':'finalized'};
}

/** Stage, validate and migrate before moving originals. Persist a recovery journal until both installs commit. */
export function restoreBackup(input:string,opts:{dbPath:string;uploadsDir:string;force?:boolean},now=Date.now(),io:{rename:typeof renameSync}={rename:renameSync}){
 const dir=canonical(input),dbPath=canonical(opts.dbPath),uploads=canonical(opts.uploadsDir);
 separate([dir,dbPath,uploads]);
 const journalPath=restoreJournalPath(dbPath);
 if(present(journalPath))throw new AppError(409,'RESTORE_RECOVERY_REQUIRED','이전 복원이 끝나지 않았습니다. 서버를 멈춘 상태에서 --recover를 먼저 실행하세요.');
 verifyBackup(dir);
 const targets=[dbPath,dbPath+'-wal',dbPath+'-shm',uploads];
 if(targets.some(present)&&!opts.force)throw new AppError(409,'TARGET_EXISTS','대상 DB·업로드가 이미 있습니다. 서버를 멈추고 --offline --force로 다시 실행하세요.');
 const suffix=`.before-restore-${stamp(now)}`;
 for(let i=0;i<targets.length;i++)if(present(targets[i])){
  const stat=lstatSync(targets[i]);if(stat.isSymbolicLink()||(i===3?!stat.isDirectory():!stat.isFile()))throw unsafe();
 }
 const entries:Entry[]=targets.map(target=>({target,previous:target+suffix,existed:present(target),...(present(target)?{beforeHash:fingerprint(target)}:{})}));
 for(const entry of entries){canonical(entry.target);if(present(entry.previous))throw new AppError(409,'RESTORE_COLLISION','같은 시각의 보존 사본이 있습니다. 기존 사본을 덮어쓸 수 없습니다.');}
 mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});mkdirSync(dirname(uploads),{recursive:true,mode:0o700});
 const stage=mkdtempSync(join(dirname(dbPath),'.naeo-restore-'));
 let uploadsStage='';
 let published=false;
 try{
  cpSync(dir,stage,{recursive:true,errorOnExist:true,force:false});verifyBackup(stage);
  uploadsStage=mkdtempSync(join(dirname(uploads),'.naeo-uploads-'));
  const stagedDb=join(stage,'db.sqlite'),stagedUploads=join(uploadsStage,'uploads');
  if(present(join(stage,'uploads')))cpSync(join(stage,'uploads'),stagedUploads,{recursive:true});
  else mkdirSync(stagedUploads,{mode:0o700});
  const db=openDatabase(stagedDb);
  try{db.exec('PRAGMA wal_checkpoint(TRUNCATE);');}finally{db.close();}
  const info=inspectDatabase(stagedDb);syncTree(stage);syncTree(uploadsStage);
  entries[0].staged=stagedDb;entries[3].staged=stagedUploads;
  const journal:Journal={version:1,ownerPid:process.pid,dbPath,stage,uploadsStage,suffix,phase:'prepared',entries};
  publishJson(journalPath,journal,true);published=true;
  for(const entry of entries)if(entry.existed){io.rename(entry.target,entry.previous);syncPath(dirname(entry.target));}
  for(const entry of entries)if(entry.staged){io.rename(entry.staged,entry.target);syncPath(dirname(entry.target));syncPath(dirname(entry.staged));}
  publishJson(journalPath,{...journal,phase:'committed'});
  recoverRestore(dbPath);
  return{...info,previousDb:entries[0].existed?entries[0].previous:null,previousUploads:entries[3].existed?entries[3].previous:null};
 }catch(e){
  if(published)recoverRestore(dbPath);else {rmSync(stage,{recursive:true,force:true});if(uploadsStage)rmSync(uploadsStage,{recursive:true,force:true});}
  throw e;
 }
}
