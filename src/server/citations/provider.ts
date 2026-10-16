/**
 * AI 브리핑 인용 확인 공급자. 네이버 공개 API에는 AI 브리핑 출처 필드가 없어
 * SerpApi의 Naver(통합검색)·Naver AI Overview(AI 브리핑) 엔진을 사용한다.
 * 요청 주소는 고정 호스트와 검증된 파라미터로만 만들고, 응답의 링크는 따라가지 않는다.
 */
export type FetchLike=(url:string,init?:RequestInit)=>Promise<Response>;
export type CitationConfig={provider:'serpapi';apiKey:string;base:string;device:'desktop'|'mobile'};
export type Reference={index:number;title:string;link:string;source:string;snippet:string};
export type BriefingMedia={position:number;title:string;link:string;thumbnail:string;platform:string};
export type Briefing={markdown:string;references:Reference[];media:BriefingMedia[];questions:string[]};
export type ResultLink={link:string;section:string;position:number};
export type SearchEvidence={briefing:Briefing|null;links:ResultLink[];searches:number};
export type CitationProvider=(keyword:string)=>Promise<SearchEvidence>;
/** scope='query'는 이 키워드만 실패(다음 글은 계속), 'run'은 작업 전체를 멈춘다. */
export class CitationError extends Error{
 constructor(public code:string,message:string,public retryable:boolean,public scope:'run'|'query'='run'){super(message);}
}

export const MAX_RESPONSE_BYTES=3*1024*1024;
const TIMEOUT_MS=30_000,MAX_REFERENCES=20,MAX_MEDIA=20,MAX_QUESTIONS=10,MAX_MARKDOWN=12_000,MAX_LINKS=300;
const loopback=(u:URL)=>u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname);

/** NAEO_CITATION_PROVIDER=serpapi와 키가 모두 있을 때만 활성화한다. 주소 대체는 로컬 검증용 loopback만. */
export function citationConfig(env:Record<string,string|undefined>=process.env):CitationConfig|null{
 try{
  if(env.NAEO_CITATION_PROVIDER!=='serpapi')return null;
  const apiKey=env.NAEO_SERPAPI_KEY??'';
  if(!/^[A-Za-z0-9_-]{20,200}$/.test(apiKey))return null;
  let base='https://serpapi.com';
  if(env.NAEO_SERPAPI_BASE){const u=new URL(env.NAEO_SERPAPI_BASE);if(!loopback(u)||u.username||u.password||u.search||u.hash||u.pathname!=='/')return null;base=u.origin;}
  return{provider:'serpapi',apiKey,base,device:env.NAEO_CITATION_DEVICE==='mobile'?'mobile':'desktop'};
 }catch{return null;}
}

const str=(v:unknown,max:number)=>typeof v==='string'?v.replace(/\p{Cc}/gu,c=>c==='\n'||c==='\t'?c:'').trim().slice(0,max):'';
const rank=(v:unknown,fallback:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=1&&v<=100?v:Math.min(100,fallback);
/** 출처 주소는 http(s)이고 1000자 이하일 때만 보관한다(javascript: 등은 버린다). */
export function httpLink(v:unknown):string{
 if(typeof v!=='string'||v.length>1000)return'';
 try{const u=new URL(v);return u.protocol==='https:'||u.protocol==='http:'?u.href:'';}catch{return'';}
}
const list=(v:unknown)=>Array.isArray(v)?v.filter((x):x is Record<string,unknown>=>!!x&&typeof x==='object'):[];

/** SerpApi ai_briefing / naver_ai_overview 응답을 크기 제한된 공통 형식으로 바꾼다. 내용이 없으면 null. */
export function briefingOf(raw:unknown):Briefing|null{
 if(!raw||typeof raw!=='object')return null;
 const b=raw as Record<string,unknown>;
 const references=list(b.references).slice(0,MAX_REFERENCES).flatMap((r,i)=>{const link=httpLink(r.link);return link?[{index:rank(r.index,i+1),title:str(r.title,200),link,source:str(r.source,100),snippet:str(r.snippet,300)}]:[];});
 const media=list(b.media).slice(0,MAX_MEDIA).flatMap((m,i)=>{const link=httpLink(m.link);return link?[{position:rank(m.position,i+1),title:str(m.title,200),link,thumbnail:httpLink(m.thumbnail),platform:str(m.platform,100)}]:[];});
 const questions=list(b.related_questions).map(q=>str(q.question,200)).filter(Boolean).slice(0,MAX_QUESTIONS);
 const markdown=str(b.markdown,MAX_MARKDOWN);
 if(!markdown&&!references.length&&!media.length)return null;
 return{markdown,references,media,questions};
}

/** 통합검색 결과에 있는 일반 결과 주소(광고·쇼핑·페이지 이동 제외). 같은 결과 묶음 안의 하위 문서는 묶음 순서를 쓴다. */
const SKIP=new Set(['search_metadata','search_parameters','search_information','pagination','serpapi_pagination','ai_briefing','ai_mode','ads_results','shopping_results','related_searches','error']);
export function resultLinks(data:Record<string,unknown>):ResultLink[]{
 const out:ResultLink[]=[];
 const walk=(node:unknown,section:string,position:number,depth:number)=>{
  if(out.length>=MAX_LINKS||depth>3||!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const item of node)walk(item,section,position,depth+1);return;}
  const o=node as Record<string,unknown>,link=httpLink(o.link);
  if(link)out.push({link,section,position});
  for(const [key,value] of Object.entries(o))if(key!=='link'&&value&&typeof value==='object')walk(value,section,position,depth+1);
 };
 for(const [section,value] of Object.entries(data)){
  if(SKIP.has(section)||!Array.isArray(value))continue;
  value.forEach((item,i)=>walk(item,section.slice(0,40),i+1,0));
 }
 return out;
}

async function boundedText(res:Response):Promise<string>{
 const reader=res.body?.getReader();if(!reader)return'';
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE_BYTES){await reader.cancel();throw new CitationError('CITATION_RESPONSE_TOO_LARGE','AI 인용 확인 응답이 너무 큽니다.',false,'query');}chunks.push(value);}}
 finally{reader.releaseLock();}
 return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}
function statusError(status:number,message:string):CitationError{
 if(status===401||status===403)return new CitationError('CITATION_PROVIDER_AUTH','AI 인용 확인 공급자 인증에 실패했습니다. 관리자에게 키 설정 확인을 요청해주세요.',false);
 if(status===429&&/run out of searches|plan/i.test(message))return new CitationError('CITATION_PROVIDER_QUOTA','AI 인용 확인 공급자의 이번 달 검색 한도를 모두 사용했습니다.',false);
 if(status===429||status>=500)return new CitationError('CITATION_PROVIDER_BUSY','AI 인용 확인 공급자가 바쁩니다. 잠시 후 다시 시도합니다.',true);
 if(status===400||status===404)return new CitationError('CITATION_QUERY_FAILED','이 키워드는 AI 인용 확인을 처리하지 못했습니다.',false,'query');
 return new CitationError('CITATION_PROVIDER_ERROR',`AI 인용 확인 공급자 오류(${status})입니다.`,false);
}
const NO_RESULTS=/hasn't returned any results|returned no results|no results for this query/i;

async function search(config:CitationConfig,params:Record<string,string>,fetchImpl:FetchLike):Promise<Record<string,unknown>>{
 const url=new URL('/search.json',config.base);
 for(const [k,v] of Object.entries({...params,device:config.device,api_key:config.apiKey}))url.searchParams.set(k,v);
 let res:Response;
 // 키가 담긴 주소는 오류 메시지·로그에 남기지 않는다.
 try{res=await fetchImpl(url.href,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(TIMEOUT_MS)});}
 catch{throw new CitationError('CITATION_PROVIDER_UNAVAILABLE','AI 인용 확인 공급자에 연결하지 못했습니다. 잠시 후 다시 시도합니다.',true);}
 const text=await boundedText(res);
 let data:unknown;try{data=JSON.parse(text);}catch{data=null;}
 const error=data&&typeof data==='object'&&typeof (data as {error?:unknown}).error==='string'?(data as {error:string}).error:'';
 if(!res.ok)throw statusError(res.status,error);
 if(!data||typeof data!=='object'||Array.isArray(data))throw new CitationError('CITATION_RESPONSE_INVALID','AI 인용 확인 응답을 해석하지 못했습니다.',true);
 if(error){if(NO_RESULTS.test(error))return{};throw new CitationError('CITATION_QUERY_FAILED','이 키워드는 AI 인용 확인을 처리하지 못했습니다.',false,'query');}
 return data as Record<string,unknown>;
}

/** 키워드 하나: 통합검색 1회 + (브리핑이 별도 토큰으로 오면) AI 브리핑 1회. */
export function serpApiProvider(config:CitationConfig,fetchImpl:FetchLike=fetch):CitationProvider{
 return async keyword=>{
  const data=await search(config,{engine:'naver',query:keyword},fetchImpl);
  const block=data.ai_briefing&&typeof data.ai_briefing==='object'?data.ai_briefing as Record<string,unknown>:null;
  let briefing=briefingOf(block),searches=1;
  if(!briefing&&block){
   const token=typeof block.page_token==='string'&&/^[A-Za-z0-9_-]{8,2000}$/.test(block.page_token)?block.page_token:'';
   if(token||typeof block.serpapi_link==='string'){
    briefing=briefingOf(await search(config,token?{engine:'naver_ai_overview',page_token:token}:{engine:'naver_ai_overview',query:keyword},fetchImpl));
    searches++;
   }
  }
  return{briefing,links:resultLinks(data),searches};
 };
}
