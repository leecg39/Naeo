import {ProviderError,type FetchLike} from '../generation/provider';

/**
 * 네이버 검색 API(오픈 API) 블로그 검색 어댑터. 키워드별 상위 노출 글과 문서 총수를 제공한다.
 * 클라이언트 ID·비밀키는 헤더에만 두고, 결과 링크는 따라가지 않는다.
 */
export type NaverSearchConfig={clientId:string;clientSecret:string;baseUrl:string};

const TIMEOUT_MS=30_000,MAX_BODY=2*1024*1024,MAX_DISPLAY=100;
const loopback=(u:URL)=>u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname);

/** 클라이언트 ID·비밀키가 모두 있을 때만 활성화한다. 주소 대체는 로컬 검증용 loopback만. */
export function naverSearchConfig(env:Record<string,string|undefined>=process.env):NaverSearchConfig|null{
 try{
  const clientId=env.NAEO_NAVER_CLIENT_ID??'',clientSecret=env.NAEO_NAVER_CLIENT_SECRET??'';
  if(!/^[A-Za-z0-9_-]{10,100}$/.test(clientId)||!/^[A-Za-z0-9_-]{8,100}$/.test(clientSecret))return null;
  let baseUrl='https://openapi.naver.com';
  if(env.NAEO_NAVER_SEARCH_BASE){const u=new URL(env.NAEO_NAVER_SEARCH_BASE);if(!loopback(u)||u.username||u.password||u.search||u.hash||u.pathname!=='/')return null;baseUrl=u.origin;}
  return{clientId,clientSecret,baseUrl};
 }catch{return null;}
}

const bounded=async(response:Response)=>{
 const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
 const chunks:Uint8Array[]=[];let total=0;
 try{for(;;){const next=await reader.read();if(next.done)break;total+=next.value.byteLength;if(total>MAX_BODY){await reader.cancel();throw new ProviderError('NAVER_SEARCH_TOO_LARGE','네이버 검색 응답이 너무 큽니다.',false);}chunks.push(next.value);}}
 finally{reader.releaseLock();}
 return Buffer.concat(chunks.map(c=>Buffer.from(c)));
};

const statusError=(status:number,code:string)=>{
 if(status===400)return new ProviderError('NAVER_SEARCH_REQUEST','네이버 검색 요청이 거절됐습니다. 키워드를 확인해주세요.',false);
 if(status===401||status===403||code==='024')return new ProviderError('NAVER_SEARCH_AUTH','네이버 검색 API 인증에 실패했습니다. 클라이언트 ID·비밀키를 확인해주세요.',false);
 if(status===429||code==='012')return new ProviderError('NAVER_SEARCH_BUSY','네이버 검색 요청 한도에 도달했습니다. 잠시 후 다시 시도합니다.',true);
 if(status>=500)return new ProviderError('NAVER_SEARCH_UNAVAILABLE','네이버 검색이 일시적으로 바쁩니다. 잠시 후 다시 시도합니다.',true);
 return new ProviderError('NAVER_SEARCH_ERROR',`네이버 검색 오류(${status})입니다.`,false);
};

/** 검색 API 본문의 HTML 태그와 엔티티를 정리하고 제어문자·길이를 제한한다. */
export const cleanText=(v:unknown,max:number)=>{
 if(typeof v!=='string')return'';
 return v.replace(/<[^>]{0,100}>/g,'').replace(/&(quot|amp|lt|gt|#39|apos);/g,m=>({'&quot;':'"','&amp;':'&','&lt;':'<','&gt;':'>','&#39;':"'",'&apos;':"'"}[m]??m)).replace(/\p{Cc}/gu,' ').trim().slice(0,max);
};
const postDate=(v:unknown)=>{
 if(typeof v!=='string')return'';
 const m=v.match(/^(\d{4})(\d{2})(\d{2})$/);
 return m?`${m[1]}-${m[2]}-${m[3]}`:'';
};

export type BlogItem={title:string;link:string;bloggerName:string;bloggerLink:string;postDate:string};
/** blog.json 한 페이지를 조회한다. total은 전체 문서 수(상한 9천만)다. */
async function searchPage(config:NaverSearchConfig,query:string,kind:'blog'|'news',{display=20,start=1}={},fetchImpl:FetchLike=fetch):Promise<{total:number;rows:Record<string,unknown>[]}>{
 const q=query.trim();
 if(!q||q.length>256)throw new ProviderError('NAVER_SEARCH_REQUEST','검색어는 1~256자입니다.',false);
 const size=Math.max(1,Math.min(MAX_DISPLAY,Math.floor(display))),from=Math.max(1,Math.min(1000,Math.floor(start)));
 const url=`${config.baseUrl}/v1/search/${kind}.json?query=${encodeURIComponent(q)}&display=${size}&start=${from}&sort=sim`;
 let res:Response;
 try{
  res=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(TIMEOUT_MS),headers:{accept:'application/json','x-naver-client-id':config.clientId,'x-naver-client-secret':config.clientSecret}});
 }catch(e){if(e instanceof ProviderError)throw e;throw new ProviderError('NAVER_SEARCH_UNAVAILABLE','네이버 검색에 연결하지 못했습니다.',true);}
 const bytes=await bounded(res);
 let data:unknown;try{data=JSON.parse(bytes.toString('utf8'));}catch{data=null;}
 const code=data&&typeof data==='object'&&typeof (data as {errorCode?:unknown}).errorCode==='string'?String((data as {errorCode?:unknown}).errorCode):'';
 if(!res.ok)throw statusError(res.status,code);
 const total=data&&typeof data==='object'?Number((data as {total?:unknown}).total):0;
 const items=data&&typeof data==='object'?(data as {items?:unknown}).items:null;
 if(typeof (data as {total?:unknown})?.total!=='number'||!Number.isInteger(total)||total<0)throw new ProviderError('NAVER_SEARCH_RESPONSE','네이버 검색에서 문서수를 확인하지 못했습니다.',false);
 return{total:Math.min(90_000_000,total),rows:(Array.isArray(items)?items:[]).slice(0,MAX_DISPLAY).filter((r):r is Record<string,unknown>=>!!r&&typeof r==='object')};
}
const safeLink=(v:unknown)=>{
 if(typeof v!=='string'||v.length>1000)return'';
 try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return'';}
};
export async function blogSearch(config:NaverSearchConfig,query:string,options:{display?:number;start?:number}={},fetchImpl:FetchLike=fetch):Promise<{total:number;items:BlogItem[]}>{
 const page=await searchPage(config,query,'blog',options,fetchImpl);
 return{total:page.total,items:page.rows.flatMap(r=>{const link=safeLink(r.link);return link?[{title:cleanText(r.title,200),link,bloggerName:cleanText(r.bloggername,100),bloggerLink:safeLink(r.bloggerlink),postDate:postDate(r.postdate)}]:[];})};
}
export type NewsItem={title:string;link:string;originalLink:string;description:string;pubDate:string};
export async function newsSearch(config:NaverSearchConfig,query:string,options:{display?:number;start?:number}={display:5},fetchImpl:FetchLike=fetch):Promise<{total:number;items:NewsItem[]}>{
 const page=await searchPage(config,query,'news',options,fetchImpl);
 return{total:page.total,items:page.rows.flatMap(r=>{const link=safeLink(r.link);return link?[{title:cleanText(r.title,200),link,originalLink:safeLink(r.originallink),description:cleanText(r.description,300),pubDate:typeof r.pubDate==='string'&&Number.isFinite(Date.parse(r.pubDate))?new Date(r.pubDate).toISOString():''}]:[];})};
}
