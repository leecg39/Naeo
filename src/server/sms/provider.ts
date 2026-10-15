import {AppError} from '../errors';
export type SmsConfig={base:string;account:string;service:string;key:string;secret:string};
export function smsConfig():SmsConfig|null{try{const e=process.env;if(e.NAEO_SMS_PROVIDER!=='twilio-verify'||!/^AC[0-9a-f]{32}$/i.test(e.NAEO_TWILIO_ACCOUNT_SID??'')||!/^VA[0-9a-f]{32}$/i.test(e.NAEO_TWILIO_VERIFY_SERVICE_SID??'')||!/^SK[0-9a-f]{32}$/i.test(e.NAEO_TWILIO_API_KEY??'')||!e.NAEO_TWILIO_API_SECRET)return null;const u=new URL(e.NAEO_SMS_API_BASE??'https://verify.twilio.com');if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||!(u.origin==='https://verify.twilio.com'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))return null;return{base:u.origin,account:e.NAEO_TWILIO_ACCOUNT_SID!,service:e.NAEO_TWILIO_VERIFY_SERVICE_SID!,key:e.NAEO_TWILIO_API_KEY!,secret:e.NAEO_TWILIO_API_SECRET};}catch{return null;}}
export function normalizedPhone(phone:string){const p=/^010\d{8}$/.test(phone)?'+82'+phone.slice(1):phone;if(!/^\+[1-9]\d{7,14}$/.test(p))throw new AppError(400,'PHONE_FORMAT','010으로 시작하는 휴대폰 번호 또는 국가번호를 포함한 + 형식으로 저장해주세요.');return p;}
export type Verification={sid:string;status:'pending'|'approved'};
export type SmsProvider={start:(phone:string)=>Promise<Verification>;check:(phone:string,sid:string,code:string)=>Promise<Verification>};
export function twilioProvider(c:SmsConfig):SmsProvider{
 async function call(path:string,fields:Record<string,string>,phone:string,sid?:string):Promise<Verification>{
 try{const r=await fetch(`${c.base}/v2/Services/${c.service}/${path}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Basic '+Buffer.from(c.key+':'+c.secret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields)});
 if(!r.ok){await r.body?.cancel();throw new AppError(r.status===429?429:502,'SMS_PROVIDER_REJECTED','인증 서비스가 요청을 처리하지 못했습니다. 잠시 후 다시 요청해주세요.');}
 const reader=r.body?.getReader();if(!reader)throw Error('empty');const chunks:Uint8Array[]=[];let bytes=0;try{while(true){const x=await reader.read();if(x.done)break;bytes+=x.value.length;if(bytes>16384){await reader.cancel();throw Error('size');}chunks.push(x.value);}}finally{reader.releaseLock();}
 const v=JSON.parse(Buffer.concat(chunks).toString());if(v.account_sid!==c.account||v.service_sid!==c.service||v.to!==phone||v.channel!=='sms'||!/^VE[0-9a-f]{32}$/i.test(v.sid)||sid&&v.sid!==sid||!['pending','approved'].includes(v.status))throw Error('identity');
 if(!sid&&v.status!=='pending')throw Error('not pending');return{sid:v.sid,status:v.status};
 }catch(e){if(e instanceof AppError)throw e;throw new AppError(502,'SMS_PROVIDER_UNAVAILABLE','인증 결과를 확인할 수 없습니다. 새 인증을 요청해주세요.');}}
 return{start:phone=>call('Verifications',{To:phone,Channel:'sms'},phone),check:(phone,sid,code)=>call('VerificationCheck',{VerificationSid:sid,Code:code},phone,sid)};
}
