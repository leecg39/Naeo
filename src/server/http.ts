import { randomUUID } from 'node:crypto';
import { ZodError, type ZodType } from 'zod';
import type { Database } from './database';
import { AppError } from './errors';
import { SESSION_COOKIE, SESSION_TTL, tokenHash } from './auth';

export const appOrigin=()=>new URL(process.env.NAEO_APP_URL || 'http://127.0.0.1:3000').origin;
export function requireOrigin(request:Request) {
  const origin=request.headers.get('origin');
  if(!origin||origin!==appOrigin()||request.headers.get('sec-fetch-site')==='cross-site') throw new AppError(403,'ORIGIN_REJECTED','이 사이트에서 요청을 다시 시도해주세요.');
}
export function cookieToken(request:Request):string|undefined {
  return (request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1);
}
export function sessionCookie(token:string,maxAge=SESSION_TTL/1000) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${appOrigin().startsWith('https:')?'; Secure':''}`;
}
export async function body<T>(request:Request,schema:ZodType<T>,max=32*1024):Promise<T> {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||'')) throw new AppError(415,'JSON_REQUIRED','JSON 형식으로 요청해주세요.');
  if(Number(request.headers.get('content-length')||0)>max) throw new AppError(413,'BODY_TOO_LARGE','요청 내용이 너무 큽니다.');
  if(!request.body) throw new AppError(400,'INVALID_JSON','요청 내용을 확인해주세요.');
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];
  let bytes=0;
  try {
    while(true) {
      const chunk=await reader.read();
      if(chunk.done) break;
      bytes+=chunk.value.byteLength;
      if(bytes>max) {await reader.cancel();throw new AppError(413,'BODY_TOO_LARGE','요청 내용이 너무 큽니다.');}
      chunks.push(chunk.value);
    }
  } finally {reader.releaseLock();}
  let parsed:unknown;
  try {parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new AppError(400,'INVALID_JSON','올바른 JSON이 아닙니다.');}
  return schema.parse(parsed);
}
export function json(data:unknown,status=200,headers?:HeadersInit) {
  const h=new Headers(headers);
  h.set('Cache-Control','no-store');h.set('X-Content-Type-Options','nosniff');
  return Response.json(data,{status,headers:h});
}
export function endpoint(action:(request:Request)=>Promise<Response>|Response) {
  return async(request:Request):Promise<Response>=>{
    const requestId=randomUUID();
    try {
      const response=await action(request);
      response.headers.set('X-Request-Id',requestId);
      return response;
    } catch(error) {
      const known=error instanceof AppError?error:error instanceof ZodError?new AppError(400,'VALIDATION_ERROR','입력 내용을 확인해주세요.',error.issues.map(i=>({path:i.path.join('.'),message:i.message}))):null;
      if(!known) console.error('[api error]',requestId,error instanceof Error?error.name:'UnknownError');
      return json({error:{code:known?.code||'INTERNAL_ERROR',message:known?.message||'요청 처리 중 오류가 발생했습니다.',...(known?.details?{details:known.details}:{})},requestId},known?.status||500,{'X-Request-Id':requestId,...(known?.status===429?{'Retry-After':'900'}:{})});
    }
  };
}
export function rateLimit(db:Database,key:string,limit:number,windowMs:number,now=Date.now()) {
  // One atomic statement; hashed keys never persist raw email addresses/IPs.
  db.prepare('DELETE FROM rate_limits WHERE reset_at<=?').run(now);
  const row=db.prepare(`INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).get(tokenHash(key),now+windowMs) as {count:number};
  if(row.count>limit) throw new AppError(429,'RATE_LIMITED','요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
}
export function authRateLimit(db:Database,request:Request,email:string) {
  const peer=process.env.NAEO_TRUST_PROXY==='1'?(request.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim():'direct';
  rateLimit(db,`auth:peer:${peer}`,100,15*60*1000);
  rateLimit(db,`auth:email:${email}`,10,15*60*1000);
}
