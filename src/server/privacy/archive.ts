import {lstatSync} from 'node:fs';
import {join} from 'node:path';
import type {Database} from '../database';
import {TarWriter} from './tar';
import {datasets,exclusions} from './datasets';
export const ARCHIVE_KEY=/^[a-f0-9]{64}\.tar$/;
export function checkedDirectory(dir:string){const s=lstatSync(dir);if(s.isSymbolicLink()||!s.isDirectory())throw new Error('UNSAFE_DIRECTORY');return dir;}
export function archiveDirectory(dir:string){checkedDirectory(dir);return checkedDirectory(join(dir,'personal-exports'));}
const imageKey=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(jpg|png|webp)$/;
const renderKey=/^[a-f0-9]{32}\.(png|pdf|zip)$/;
type Attachment={id:string;key:string;size:number;originalName?:string};
function attachments(db:Database,dir:string,owner:string,writer:TarWriter,now:number){
 const items=[];
 for(const r of db.prepare('SELECT public_id AS id,storage_key AS key,size,original_name AS originalName FROM media_files WHERE owner_id=? ORDER BY rowid').iterate(owner) as Iterable<Attachment>){
  if(!imageKey.test(r.key)||!/^[A-Za-z0-9_-]{22}$/.test(r.id))throw new Error('INVALID_STORAGE_KEY');
  const path=`attachments/media/${r.id}.${r.key.split('.').pop()}`;
  items.push({id:r.id,source:'media',originalName:r.originalName,...writer.file(path,join(checkedDirectory(dir),r.key),r.size)});
 }
 const query=`SELECT id,file_key AS key,file_size AS size FROM export_jobs WHERE owner_id=? AND state='succeeded' AND file_key IS NOT NULL AND expires_at>?`;
 for(const r of db.prepare(query).iterate(owner,now) as Iterable<Attachment>){items.push(renderFile(dir,writer,r,'creative'));}
 const pages=`SELECT j.id||'-'||p.position AS id,p.storage_key AS key,p.size FROM export_pages p JOIN export_jobs j ON j.id=p.job_id WHERE j.owner_id=? AND j.state='collecting' AND j.expires_at>? ORDER BY j.id,p.position`;
 for(const r of db.prepare(pages).iterate(owner,now) as Iterable<Attachment>){items.push(renderFile(dir,writer,r,'creative_page'));}
 return items;
}
function renderFile(dir:string,writer:TarWriter,r:Attachment,source:string){
 if(!renderKey.test(r.key)||!/^[a-f0-9-]{36}(?:-\d+)?$/.test(r.id)||!Number.isSafeInteger(r.size))throw new Error('INVALID_STORAGE_KEY');
 const path=`attachments/${source}/${r.id}.${r.key.split('.').pop()}`;
 return{id:r.id,source,...writer.file(path,join(checkedDirectory(join(dir,'exports')),r.key),r.size)};
}
/** Caller holds a SQLite read snapshot. Files are immutable by application convention; changed/missing files fail the whole job. */
export function buildPersonalArchive(db:Database,dir:string,owner:string,key:string,now:number){
 if(!ARCHIVE_KEY.test(key))throw new Error('INVALID_STORAGE_KEY');
 const writer=new TarWriter(join(archiveDirectory(dir),key));
 try{
  const tables=datasets.map(d=>writer.rows(`data/${d.name}.ndjson`,db.prepare(d.sql).iterate(owner)));
  const files=attachments(db,dir,owner,writer,now);
  writer.json('manifest.json',{format:'naeo-personal-data',version:1,schemaVersion:db.prepare('SELECT max(version) AS version FROM schema_migrations').get()!.version,snapshotAt:new Date(now).toISOString(),datasets:tables,attachments:files,exclusions,
   attachmentPolicy:'All owned stored media and unexpired creative files/pages at snapshot time. Missing/changed required files fail the job; expired creative artifacts are represented by metadata only.',
   consistency:'SQLite read snapshot; attachment reads checked for size and modification. Database and filesystem are not a single atomic snapshot.'});
  return writer.finish();
 }finally{writer.close();}
}
