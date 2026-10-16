import {spawn} from 'node:child_process';
import {accessSync,constants,statSync} from 'node:fs';
import {delimiter,isAbsolute,join,resolve} from 'node:path';
import {AppError} from '../errors';

export const MP4_TIMEOUT_MS=5*60_000,MAX_MP4_BYTES=256*1024*1024;
const UNAVAILABLE='현재 MP4 내보내기를 사용할 수 없습니다. PDF 또는 PNG 묶음을 이용해주세요.';
export const encoderUnavailable=()=>new AppError(503,'EXPORT_ENCODER_UNAVAILABLE',UNAVAILABLE);
/** Only executable local binaries are accepted; shell expansion is never used. */
export function encoderPath():string{
 const configured=process.env.NAEO_FFMPEG_PATH?.trim()||'ffmpeg';
 // FFmpeg is an operator-installed executable, not a file to trace into the Next.js bundle.
 const candidates=configured.includes('/')?[resolve(/* turbopackIgnore: true */ configured)]:(process.env.PATH??'').split(delimiter).filter(isAbsolute).map(dir=>join(/* turbopackIgnore: true */ dir,configured));
 for(const path of candidates)try{accessSync(path,constants.X_OK);if(statSync(path).isFile())return path;}catch{/* Try next PATH entry. */}
 throw encoderUnavailable();
}
export class EncoderFailure extends Error{
 constructor(public code:'FAILED'|'TIMEOUT'|'CANCELED'|'LIMIT'){super(code);}
}
type ProcessOptions={cwd?:string;signal?:AbortSignal;timeoutMs:number;onOutput?:(text:string)=>void;outputFile?:string};
/** Bounded async subprocess: no shell/stdin, capped logs/file size, TERM then KILL on cancel/timeout. */
export function encoderProcess(binary:string,args:string[],options:ProcessOptions):Promise<string>{
 return new Promise((resolveResult,reject)=>{
  if(options.signal?.aborted){reject(new EncoderFailure('CANCELED'));return;}
  const child=spawn(binary,args,{cwd:options.cwd,shell:false,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let stdout='',logged=0,reason:EncoderFailure|undefined,killTimer:ReturnType<typeof setTimeout>|undefined,finished=false;
  const stop=(failure:EncoderFailure)=>{if(finished||reason)return;reason=failure;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);};
  const abort=()=>stop(new EncoderFailure('CANCELED'));
  const timer=setTimeout(()=>stop(new EncoderFailure('TIMEOUT')),options.timeoutMs);
  const fileTimer=options.outputFile?setInterval(()=>{try{if(statSync(options.outputFile!).size>MAX_MP4_BYTES)stop(new EncoderFailure('LIMIT'));}catch{/* Not created yet. */}},250):undefined;
  const cleanup=()=>{finished=true;clearTimeout(timer);if(killTimer)clearTimeout(killTimer);if(fileTimer)clearInterval(fileTimer);options.signal?.removeEventListener('abort',abort);};
  options.signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',(bytes:Buffer)=>{logged+=bytes.length;if(logged>128*1024){stop(new EncoderFailure('LIMIT'));return;}const text=bytes.toString();stdout=(stdout+text).slice(-64*1024);options.onOutput?.(text);});
  child.stderr.on('data',(bytes:Buffer)=>{logged+=bytes.length;if(logged>128*1024)stop(new EncoderFailure('LIMIT'));});
  child.once('error',()=>{cleanup();reject(encoderUnavailable());});
  child.once('close',code=>{cleanup();if(reason)reject(reason);else if(code!==0)reject(new EncoderFailure('FAILED'));else resolveResult(stdout);});
 });
}
const probes=new Map<string,{until:number;pending:Promise<boolean>}>();
export async function mp4Capability():Promise<{available:boolean;message:string}>{
 let binary:string;try{binary=encoderPath();}catch{return{available:false,message:UNAVAILABLE};}
 let cached=probes.get(binary);
 if(!cached||cached.until<Date.now()){
  const pending=encoderProcess(binary,['-hide_banner','-encoders'],{timeoutMs:3000}).then(output=>/\blibx264\b/.test(output),()=>false);
  cached={until:Date.now()+30_000,pending};probes.set(binary,cached);
  // Configuration changes should not accumulate binaries indefinitely.
  if(probes.size>8)for(const key of probes.keys()){if(key!==binary)probes.delete(key);}
 }
 const available=await cached.pending;return{available,message:available?'H.264 MP4 · 무음 · 장당 1~30초':UNAVAILABLE};
}
export async function requireMp4Encoder(){if(!(await mp4Capability()).available)throw encoderUnavailable();}
