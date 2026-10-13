import {createHash} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,readdirSync,readFileSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openDatabase,type Database} from '../database';
import {AppError} from '../errors';

export type Manifest={createdAt:string;schemaVersion:number;counts:Record<string,number>;files:number;sha256:string};
const stamp=(ms:number)=>new Date(ms).toISOString().replace(/\.\d{3}Z$/,'Z').replace(/:/g,'-');
const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
function countFiles(dir:string):number{
 if(!existsSync(dir))return 0;
 return readdirSync(dir).reduce((n,name)=>{const p=join(dir,name);return n+(statSync(p).isDirectory()?countFiles(p):1);},0);
}
function tableCounts(db:Database):Record<string,number>{
 const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(r=>r.name);
 return Object.fromEntries(tables.map(t=>[t,(db.prepare(`SELECT count(*) AS n FROM "${t.replace(/"/g,'""')}"`).get() as {n:number}).n]));
}

/**
 * 백업: 실행 중에도 일관된 DB 사본(VACUUM INTO, WAL 반영)과 업로드 폴더 복사, 체크섬·표별 건수 manifest.
 * 대상 폴더는 매번 새로 만들고 기존 백업을 덮어쓰지 않는다.
 */
export function createBackup(db:Database,opts:{uploadsDir:string;destDir:string},now=Date.now()){
 const dir=join(opts.destDir,`naeo-${stamp(now)}`);
 if(existsSync(dir))throw new AppError(409,'BACKUP_EXISTS','같은 시각의 백업이 이미 있습니다.');
 mkdirSync(dir,{recursive:true,mode:0o700});
 const dbFile=join(dir,'db.sqlite');
 db.exec(`VACUUM INTO '${dbFile.replace(/'/g,"''")}'`);
 if(existsSync(opts.uploadsDir))cpSync(opts.uploadsDir,join(dir,'uploads'),{recursive:true});
 const snapshot=openDatabase(dbFile);
 let manifest:Manifest;
 try{manifest={createdAt:new Date(now).toISOString(),schemaVersion:(snapshot.prepare('SELECT max(version) AS v FROM schema_migrations').get() as {v:number}).v,counts:tableCounts(snapshot),files:countFiles(join(dir,'uploads')),sha256:''};}
 finally{snapshot.close();}
 manifest={...manifest,sha256:sha(dbFile)};
 writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest,null,1)+'\n',{mode:0o600});
 return{dir,manifest};
}

/** manifest의 체크섬과 DB 파일이 같은지 확인한다. */
export function verifyBackup(dir:string){
 const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8')) as Manifest;
 if(!existsSync(join(dir,'db.sqlite'))||sha(join(dir,'db.sqlite'))!==manifest.sha256)throw new AppError(400,'BACKUP_CORRUPT','백업 DB 체크섬이 manifest와 다릅니다.');
 return{ok:true,manifest};
}

/**
 * 복원(서버·작업자를 멈춘 뒤 실행): 체크섬 확인 → 기존 DB·WAL·업로드를 .before-restore-시각으로 옮겨 보존 → 복사 →
 * 다시 열어 마이그레이션을 적용하고 표별 건수를 돌려준다. 대상이 있으면 force 없이는 거절한다.
 */
export function restoreBackup(dir:string,opts:{dbPath:string;uploadsDir:string;force?:boolean},now=Date.now()){
 verifyBackup(dir);
 if(existsSync(opts.dbPath)&&!opts.force)throw new AppError(409,'TARGET_EXISTS','대상 DB가 이미 있습니다. 서버를 멈추고 --force로 다시 실행하세요(기존 파일은 보존됩니다).');
 const suffix=`.before-restore-${stamp(now)}`;
 let previousDb:string|null=null,previousUploads:string|null=null;
 if(existsSync(opts.dbPath)){
  previousDb=opts.dbPath+suffix;renameSync(opts.dbPath,previousDb);
  for(const ext of ['-wal','-shm'])if(existsSync(opts.dbPath+ext))renameSync(opts.dbPath+ext,previousDb+ext);
 }
 if(existsSync(opts.uploadsDir)){previousUploads=opts.uploadsDir+suffix;renameSync(opts.uploadsDir,previousUploads);}
 cpSync(join(dir,'db.sqlite'),opts.dbPath);
 if(existsSync(join(dir,'uploads')))cpSync(join(dir,'uploads'),opts.uploadsDir,{recursive:true});
 const db=openDatabase(opts.dbPath);
 try{return{counts:tableCounts(db),schemaVersion:(db.prepare('SELECT max(version) AS v FROM schema_migrations').get() as {v:number}).v,previousDb,previousUploads};}
 finally{db.close();}
}
