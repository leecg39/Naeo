import {randomBytes} from 'node:crypto';
import {chmodSync,copyFileSync,mkdirSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {transaction,type Database} from '../database';
import {audit} from '../audit';
import {AppError} from '../errors';
import {encoderPath,encoderProcess,EncoderFailure,MAX_MP4_BYTES,MP4_TIMEOUT_MS,requireMp4Encoder} from './mp4';
import {exportPageKeys,exportPath,failExport,KEEP_TTL,removeExportFile} from './exports';

export const MP4_LEASE_MS=30_000,MP4_MAX_ATTEMPTS=3;
type Claimed={id:string;ownerId:string;slideCount:number;secondsPerSlide:number;width:number;height:number;token:string};
function claim(db:Database,dir:string,now:number):Claimed|null{
 return transaction(db,()=>{
  const stale=db.prepare("SELECT id,attempt FROM export_jobs WHERE state='encoding' AND (lease_until IS NULL OR lease_until<=?)").all(now) as {id:string;attempt:number}[];
  for(const j of stale){
   if(j.attempt>=MP4_MAX_ATTEMPTS)failExport(db,dir,j.id,'인코딩 작업이 반복해서 중단되었습니다. 다시 내보내주세요.',now);
   else db.prepare("UPDATE export_jobs SET state='queued',lease_token=NULL,lease_until=NULL,progress=0,updated_at=? WHERE id=?").run(now,j.id);
  }
  // Bound CPU/memory across all worker processes sharing this database.
  if(db.prepare("SELECT 1 FROM export_jobs WHERE state='encoding' AND lease_until>? LIMIT 1").get(now))return null;
  const job=db.prepare("SELECT id,owner_id AS ownerId,slide_count AS slideCount,seconds_per_slide AS secondsPerSlide,width,height FROM export_jobs WHERE format='mp4' AND state='queued' AND expires_at>? ORDER BY created_at,id LIMIT 1").get(now) as Omit<Claimed,'token'>|undefined;
  if(!job)return null;
  const token=randomBytes(16).toString('hex');
  db.prepare("UPDATE export_jobs SET state='encoding',progress=0,lease_token=?,lease_until=?,attempt=attempt+1,updated_at=? WHERE id=?").run(token,now+MP4_LEASE_MS,now,job.id);
  return{...job,token};
 });
}
function heartbeat(db:Database,workerId:string,at:number){
 db.prepare('INSERT INTO worker_heartbeats(worker_id,started_at,last_seen_at,processed,failed) VALUES(?,?,?,0,0) ON CONFLICT(worker_id) DO UPDATE SET last_seen_at=excluded.last_seen_at').run(workerId,at,at);
}
const owns=(db:Database,job:Claimed,now:number)=>Boolean(db.prepare("SELECT 1 FROM export_jobs WHERE id=? AND owner_id=? AND state='encoding' AND lease_token=? AND lease_until>? AND expires_at>?").get(job.id,job.ownerId,job.token,now,now));
const message=(e:unknown)=>e instanceof AppError&&e.code==='EXPORT_ENCODER_UNAVAILABLE'?e.message:e instanceof EncoderFailure&&e.code==='TIMEOUT'?'MP4 인코딩 제한 시간(5분)을 초과했습니다. 장 수나 재생 시간을 줄여 다시 시도해주세요.':e instanceof EncoderFailure&&e.code==='LIMIT'?'MP4 출력 제한(256MB)을 초과했습니다. 장 수나 재생 시간을 줄여 다시 시도해주세요.':'MP4 인코딩에 실패했습니다. 다시 내보내주세요.';

/** Process one queued MP4 asynchronously. Lease fencing prevents stale/deleted jobs from publishing. */
export async function runCreativeExportOnce(db:Database,dir:string,workerId:string,{signal,now=Date.now,timeoutMs=MP4_TIMEOUT_MS}:{signal?:AbortSignal;now?:()=>number;timeoutMs?:number}={}):Promise<string|null>{
 if(signal?.aborted)return null;
 heartbeat(db,workerId,now());
 const job=claim(db,dir,now());if(!job)return null;
 const controller=new AbortController(),abort=()=>controller.abort();
 signal?.addEventListener('abort',abort,{once:true});
 const temp=resolve(dir,'exports',`mp4-${job.token}`),output=join(temp,'output.mp4');
 let key:string|null=null,progress=0;
 const leaseTimer=setInterval(()=>{
  try{
   const at=now();
   heartbeat(db,workerId,at);
   const renewed=db.prepare("UPDATE export_jobs SET lease_until=?,progress=?,updated_at=? WHERE id=? AND state='encoding' AND lease_token=? AND lease_until>? AND expires_at>?").run(at+MP4_LEASE_MS,progress,at,job.id,job.token,at,at);
   if(!renewed.changes)controller.abort();
  }catch{controller.abort();}
 },1000);
 try{
  await requireMp4Encoder();
  if(controller.signal.aborted||!owns(db,job,now()))throw new EncoderFailure('CANCELED');
  const keys=exportPageKeys(db,job.id);
  if(keys.length!==job.slideCount)throw new Error('PAGES_MISSING');
  if(job.width<2||job.height<2||job.width>4096||job.height>4096||job.width%2||job.height%2)throw new Error('INVALID_DIMENSIONS');
  mkdirSync(temp,{recursive:true,mode:0o700});
  const list=['ffconcat version 1.0'];
  keys.forEach((source,i)=>{
   const name=`slide-${String(i).padStart(2,'0')}.png`;
   copyFileSync(exportPath(dir,source),join(temp,name));chmodSync(join(temp,name),0o600);
   list.push(`file '${name}'`,`duration ${job.secondsPerSlide}`);
  });
  list.push(`file 'slide-${String(keys.length-1).padStart(2,'0')}.png'`);
  writeFileSync(join(temp,'slides.ffconcat'),list.join('\n')+'\n',{flag:'wx',mode:0o600});
  // Precreate the private output so FFmpeg never creates a world-readable file.
  writeFileSync(output,'',{flag:'wx',mode:0o600});
  let lineBuffer='',encodedSeconds=0;
  const duration=job.slideCount*job.secondsPerSlide;
  await encoderProcess(encoderPath(),[
   '-hide_banner','-loglevel','error','-nostdin','-y','-max_alloc','67108864','-threads','2','-filter_threads','1',
   '-protocol_whitelist','file','-f','concat','-safe','1','-i','slides.ffconcat','-map','0:v:0','-an',
   '-vf','fps=30,format=yuv420p','-c:v','libx264','-preset','veryfast','-crf','20','-threads','2',
   '-t',String(duration),'-fs',String(MAX_MP4_BYTES),'-movflags','+faststart','-progress','pipe:1','-nostats',output
  ],{cwd:temp,signal:controller.signal,timeoutMs,outputFile:output,onOutput:text=>{
   lineBuffer+=text;const lines=lineBuffer.split('\n');lineBuffer=lines.pop()!.slice(-1024);
   for(const line of lines){const match=line.match(/^out_time_us=(\d+)$/);if(match){encodedSeconds=Math.max(encodedSeconds,Number(match[1])/1_000_000);progress=Math.min(99,Math.floor(encodedSeconds/duration*100));}}
  }});
  const size=statSync(output).size;
  if(size<32||size>=MAX_MP4_BYTES||encodedSeconds<duration-0.1)throw new EncoderFailure('LIMIT');
  transaction(db,()=>{
   const at=now();
   if(controller.signal.aborted||!owns(db,job,at))throw new EncoderFailure('CANCELED');
   key=`${randomBytes(16).toString('hex')}.mp4`;
   renameSync(output,exportPath(dir,key));
   db.prepare("UPDATE export_jobs SET state='succeeded',file_key=?,file_size=?,progress=100,lease_token=NULL,lease_until=NULL,expires_at=?,updated_at=? WHERE id=? AND lease_token=?").run(key,size,at+KEEP_TTL,at,job.id,job.token);
   db.prepare('DELETE FROM export_pages WHERE job_id=?').run(job.id);
   audit(db,job.ownerId,'creative.export.complete','export_job',job.id,{format:'mp4',bytes:size,seconds:duration,worker:workerId});
  });
  key=null; // Committed: cleanup must not delete this file.
  for(const source of keys)removeExportFile(dir,source);
 }catch(error){
  if(key)removeExportFile(dir,key);
  transaction(db,()=>{
   const at=now();
   if(!owns(db,job,at))return;
   if(signal?.aborted){
    // Service shutdown is resumable and does not consume a retry.
    db.prepare("UPDATE export_jobs SET state='queued',progress=0,lease_token=NULL,lease_until=NULL,attempt=max(0,attempt-1),updated_at=? WHERE id=? AND lease_token=?").run(at,job.id,job.token);
   }else failExport(db,dir,job.id,message(error),at);
  });
 }finally{
  clearInterval(leaseTimer);signal?.removeEventListener('abort',abort);
  rmSync(temp,{recursive:true,force:true});
 }
 return job.id;
}
