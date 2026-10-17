import {createHmac} from 'node:crypto';
import {ProviderError,type FetchLike} from '../generation/provider';

/**
 * 네이버 검색광고 API(광고 시스템) 어댑터. 월간 검색량은 keywordstool이 제공한다.
 * 서명: X-API-SIGNATURE = base64(HMAC-SHA256(secret, "{timestamp}.{method}.{uri}")).
 * 요청 주소는 고정 경로와 검증된 파라미터로만 만들고 키는 헤더에만 둔다.
 */
export type SearchAdConfig={apiKey:string;secret:string;customerId:string;baseUrl:string};

const TIMEOUT_MS=30_000,MAX_BODY=2*1024*1024,MAX_HINTS=5;
const loopback=(u:URL)=>u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname);

/** 세 값이 모두 있을 때만 활성화한다. 주소 대체는 로컬 검증용 loopback만. */
export function searchAdConfig(env:Record<string,string|undefined>=process.env):SearchAdConfig|null{
 try{
  const apiKey=env.NAEO_SEARCHAD_API_KEY??'',secret=env.NAEO_SEARCHAD_SECRET??'',customerId=env.NAEO_SEARCHAD_CUSTOMER_ID??'';
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(apiKey)||!secret||secret.length>200||!/^\d{3,20}$/.test(customerId))return null;
  let baseUrl='https://api.searchad.naver.com';
  if(env.NAEO_SEARCHAD_BASE){const u=new URL(env.NAEO_SEARCHAD_BASE);if(!loopback(u)||u.username||u.password||u.search||u.hash||u.pathname!=='/')return null;baseUrl=u.origin;}
  return{apiKey,secret,customerId,baseUrl};
 }catch{return null;}
}

const bounded=async(response:Response)=>{
 const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
 const chunks:Uint8Array[]=[];let total=0;
 try{for(;;){const next=await reader.read();if(next.done)break;total+=next.value.byteLength;if(total>MAX_BODY){await reader.cancel();throw new ProviderError('SEARCHAD_TOO_LARGE','검색광고 응답이 너무 큽니다.',false);}chunks.push(next.value);}}
 finally{reader.releaseLock();}
 return Buffer.concat(chunks.map(c=>Buffer.from(c)));
};

const statusError=(status:number)=>{
 if(status===400)return new ProviderError('SEARCHAD_REQUEST','검색광고 요청이 거절됐습니다. 키워드를 확인해주세요.',false);
 if(status===401||status===403)return new ProviderError('SEARCHAD_AUTH','검색광고 API 인증에 실패했습니다. 라이선스 키·고객 ID를 확인해주세요.',false);
 if(status===404)return new ProviderError('SEARCHAD_NOT_FOUND','검색광고 API 주소가 없습니다.',false);
 if(status===429)return new ProviderError('SEARCHAD_BUSY','검색광고 요청 한도에 도달했습니다. 잠시 후 다시 시도합니다.',true);
 if(status>=500)return new ProviderError('SEARCHAD_UNAVAILABLE','검색광고 API가 일시적으로 바쁩니다. 잠시 후 다시 시도합니다.',true);
 return new ProviderError('SEARCHAD_ERROR',`검색광고 API 오류(${status})입니다.`,false);
};

/** 월간 검색량은 "< 10" 같은 문자열로 내려올 수 있다. 새 규칙: 상한 미만 최대 정수로 환산한다. */
export const volumeOf=(v:unknown):number=>{
 if(typeof v==='number'&&Number.isFinite(v))return Math.max(0,Math.min(100_000_000,Math.floor(v)));
 if(typeof v==='string'){const m=v.match(/^<\s*(\d{1,9})$/);if(m)return Math.max(0,Number(m[1])-1);}
 return 0;
};
export const normalizePhrase=(s:string)=>s.replace(/\s+/g,'').toLowerCase();

export type KeywordStat={phrase:string;pcVolume:number;mobileVolume:number;compIdx:string};
/** 검색광고가 반환한 실측 연관어를 보존한다. 입력은 최대 5개, 출력은 최대 100개다. */
export async function relatedKeywordStats(config:SearchAdConfig,phrases:string[],fetchImpl:FetchLike=fetch):Promise<Map<string,KeywordStat>>{
 if(!phrases.length||phrases.length>MAX_HINTS)throw new ProviderError('SEARCHAD_REQUEST','검색광고 지표는 한 번에 1~5개 키워드만 조회합니다.',false);
 const uri='/keywordstool';
 const url=`${config.baseUrl}${uri}?hintKeywords=${encodeURIComponent(phrases.join(','))}&showDetail=1`;
 const timestamp=String(Date.now());
 const signature=createHmac('sha256',config.secret).update(`${timestamp}.GET.${uri}`).digest('base64');
 let res:Response;
 try{
  res=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(TIMEOUT_MS),headers:{accept:'application/json','x-api-key':config.apiKey,'x-customer':config.customerId,'x-timestamp':timestamp,'x-api-signature':signature}});
 }catch(e){if(e instanceof ProviderError)throw e;throw new ProviderError('SEARCHAD_UNAVAILABLE','검색광고 API에 연결하지 못했습니다.',true);}
 const bytes=await bounded(res);
 let data:unknown;try{data=JSON.parse(bytes.toString('utf8'));}catch{data=null;}
 if(!res.ok)throw statusError(res.status);
 const list=data&&typeof data==='object'?(data as {keywordList?:unknown}).keywordList:null;
 const out=new Map<string,KeywordStat>();
 if(!Array.isArray(list))return out;
 const exact=(row:unknown)=>!!row&&typeof row==='object'&&typeof (row as {relKeyword?:unknown}).relKeyword==='string'&&phrases.some(p=>normalizePhrase(p)===normalizePhrase(String((row as {relKeyword:string}).relKeyword)));
 for(const row of [...list].sort((a,b)=>Number(exact(b))-Number(exact(a)))){
  if(!row||typeof row!=='object')continue;
  const rel=(row as {relKeyword?:unknown}).relKeyword;
  if(typeof rel!=='string'||!rel)continue;
  const key=normalizePhrase(rel);
  if(out.has(key)||rel.length>60||out.size>=100)continue;
  const comp=(row as {compIdx?:unknown}).compIdx;
  out.set(key,{phrase:rel.slice(0,60),pcVolume:volumeOf((row as {monthlyPcQcCnt?:unknown}).monthlyPcQcCnt),mobileVolume:volumeOf((row as {monthlyMobileQcCnt?:unknown}).monthlyMobileQcCnt),compIdx:typeof comp==='string'?comp.slice(0,10):''});
 }
 return out;
}

/** 기존 수집기는 입력한 키워드와 일치하는 지표만 받는다. */
export async function keywordStats(config:SearchAdConfig,phrases:string[],fetchImpl:FetchLike=fetch):Promise<Map<string,KeywordStat>>{
 const hints=new Set(phrases.map(normalizePhrase));
 return new Map([...await relatedKeywordStats(config,phrases,fetchImpl)].filter(([key])=>hints.has(key)));
}
