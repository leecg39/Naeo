import {readdirSync,statSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {transaction,type Database} from '../database';

const KEY=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/;
const ORPHAN_GRACE=60*60_000,LIMIT=100;
const errorCode=(e:unknown)=>/^[A-Z0-9_]{1,40}$/.test(String((e as NodeJS.ErrnoException)?.code))?String((e as NodeJS.ErrnoException).code):'IO_ERROR';

/** A deletion tombstone survives account cascades and IO failures; the DB lock prevents races with uploads. */
export function deleteStoredMedia(db:Database,dir:string,key:string,now=Date.now()):'removed'|'failed'|'absent'{
 return transaction(db,()=>{
  if(!db.prepare('SELECT 1 FROM media_deletions WHERE storage_key=?').get(key))return'absent';
  let error=KEY.test(key)?'':'INVALID_STORAGE_KEY';
  if(!error&&db.prepare('SELECT 1 FROM media_files WHERE storage_key=?').get(key))error='STILL_REFERENCED';
  if(!error)try{unlinkSync(join(dir,key));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')error=errorCode(e);}
  if(error){
   db.prepare('UPDATE media_deletions SET attempts=attempts+1,last_attempt_at=?,last_error_code=? WHERE storage_key=?').run(now,error,key);
   return'failed';
  }
  db.prepare('DELETE FROM media_deletions WHERE storage_key=?').run(key);
  return'removed';
 });
}

/** Recover files left by pre-migration account deletion or a crash between writing a file and inserting its row. */
function queueOrphans(db:Database,dir:string,now:number):string|null{
 let files;
 try{files=readdirSync(dir,{withFileTypes:true});}catch(e){return (e as NodeJS.ErrnoException).code==='ENOENT'?null:errorCode(e);}
 let queued=0;
 for(const file of files){
  if(queued>=LIMIT)break;
  if(!file.isFile()||!KEY.test(file.name))continue;
  try{
   if(now-statSync(join(dir,file.name)).mtimeMs<ORPHAN_GRACE)continue;
   queued+=transaction(db,()=>Number(db.prepare(`INSERT INTO media_deletions(storage_key,queued_at)
    SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM media_files WHERE storage_key=?) ON CONFLICT DO NOTHING`).run(file.name,now,file.name).changes));
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')return errorCode(e);}
 }
 return null;
}

/** Called every minute by the worker. Failed files remain queued and are retried fairly across batches. */
export function cleanupMedia(db:Database,dir:string,now=Date.now()){
 const scanError=queueOrphans(db,dir,now);
 const rows=db.prepare('SELECT storage_key AS k FROM media_deletions ORDER BY coalesce(last_attempt_at,0),queued_at LIMIT ?').all(LIMIT) as {k:string}[];
 let removed=0,failed=0;
 for(const {k} of rows){const result=deleteStoredMedia(db,dir,k,now);if(result==='removed')removed++;if(result==='failed')failed++;}
 return{removed,failed,scanError};
}
