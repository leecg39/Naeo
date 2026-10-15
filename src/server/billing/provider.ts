import {z} from 'zod';

/** 공급자가 돌려준 결제 상태(토스 Payment 객체 중 쓰는 칸만). */
export type ProviderPayment={paymentKey:string;orderId:string;status:string;totalAmount:number;balanceAmount:number;method:string;approvedAt:string|null};
export class ProviderError extends Error{
 constructor(public code:string,message:string,public status:number){super(message);this.name='ProviderError';}
}
export interface PaymentProvider{
 readonly name:'toss';
 readonly clientKey:string;
 confirm(input:{paymentKey:string;orderId:string;amount:number},idempotencyKey:string):Promise<ProviderPayment>;
 get(paymentKey:string):Promise<ProviderPayment>;
 cancel(paymentKey:string,input:{reason:string;amount:number},idempotencyKey:string):Promise<ProviderPayment>;
}

const paymentShape=z.object({paymentKey:z.string().min(1).max(200),orderId:z.string().min(6).max(64),status:z.string().min(1).max(40),totalAmount:z.number().int().nonnegative().safe(),balanceAmount:z.number().int().nonnegative().safe(),method:z.string().nullable().optional(),approvedAt:z.string().nullable().optional()}).passthrough().refine(p=>p.balanceAmount<=p.totalAmount);
const errorShape=z.object({code:z.string().optional(),message:z.string().optional()}).passthrough();
const TIMEOUT=15_000;

/** API 주소는 https만, 로컬 검증용으로 localhost http만 허용한다. */
export function safeBase(raw:string|undefined):string{
 const url=new URL(raw||'https://api.tosspayments.com');
 const local=url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname);
 if(url.protocol!=='https:'&&!local)throw new Error('NAEO_TOSS_API_BASE must be https (or http://localhost for local checks)');
 return url.origin;
}

/**
 * 토스페이먼츠 코어 API(문서: docs.tosspayments.com/reference).
 * 승인 POST /v1/payments/confirm, 조회 GET /v1/payments/{paymentKey}, 취소 POST /v1/payments/{paymentKey}/cancel.
 * 인증은 Basic base64(시크릿 키 + ':'), 승인·취소는 Idempotency-Key 헤더로 재시도해도 한 번만 처리된다.
 * 키가 없으면 null(결제 기능은 '미설정'으로 표시).
 */
export function tossProvider(env:Record<string,string|undefined>=process.env):PaymentProvider|null{
 const clientKey=env.NAEO_TOSS_CLIENT_KEY,secretKey=env.NAEO_TOSS_SECRET_KEY;
 if(!clientKey||!secretKey)return null;
 const base=safeBase(env.NAEO_TOSS_API_BASE);
 const auth='Basic '+Buffer.from(`${secretKey}:`).toString('base64');
 async function call(path:string,init:{method:'GET'|'POST';body?:unknown;idempotencyKey?:string}):Promise<ProviderPayment>{
  const headers:Record<string,string>={Authorization:auth,...(init.body!==undefined?{'Content-Type':'application/json'}:{}),...(init.idempotencyKey?{'Idempotency-Key':init.idempotencyKey}:{})};
  let response:Response;
  try{response=await fetch(base+path,{method:init.method,headers,body:init.body===undefined?undefined:JSON.stringify(init.body),signal:AbortSignal.timeout(TIMEOUT),redirect:'error'});}
  catch{throw new ProviderError('PROVIDER_UNREACHABLE','결제사에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.',503);}
  const json=await response.json().catch(()=>({}));
  if(!response.ok){const e=errorShape.safeParse(json);throw new ProviderError(e.success&&e.data.code?e.data.code.slice(0,60):`HTTP_${response.status}`,(e.success&&e.data.message?e.data.message:'결제사 오류').slice(0,300),response.status);}
  const p=paymentShape.safeParse(json);
  if(!p.success)throw new ProviderError('PROVIDER_BAD_RESPONSE','결제사 응답을 해석하지 못했습니다.',502);
  return{paymentKey:p.data.paymentKey,orderId:p.data.orderId,status:p.data.status,totalAmount:p.data.totalAmount,balanceAmount:p.data.balanceAmount,method:(p.data.method??'').slice(0,40),approvedAt:p.data.approvedAt??null};
 }
 return{
  name:'toss',clientKey,
  confirm:(input,key)=>call('/v1/payments/confirm',{method:'POST',body:input,idempotencyKey:key}),
  get:paymentKey=>call(`/v1/payments/${encodeURIComponent(paymentKey)}`,{method:'GET'}),
  cancel:(paymentKey,input,key)=>call(`/v1/payments/${encodeURIComponent(paymentKey)}/cancel`,{method:'POST',body:{cancelReason:input.reason,cancelAmount:input.amount},idempotencyKey:key}),
 };
}
