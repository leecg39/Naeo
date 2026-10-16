import {ProviderError,type FetchLike} from './provider';
import {MAX_IMAGE_BYTES,sniffImage} from '../writing/media';

/** AI 이미지 생성 공급자. 지금은 OpenAI Images API(API 키, OAuth와 별개)를 지원한다. */
export type ImageConfig={provider:'openai';apiKey:string;baseUrl:string;model:string;size:'1024x1024'|'1024x1536'|'1536x1024'|'1792x1024'|'1024x1792'};
export type ImageRequest={prompt:string;index:number};
export type ImageProvider=(request:ImageRequest)=>Promise<Buffer>;

const TIMEOUT_MS=180_000,MAX_BODY=32*1024*1024;

/** 이미지 공급자는 명시 설정이 있을 때만 켠다. 기본 주소는 https, 개발용 http는 이 서버 안(loopback)만 허용. */
export function imageConfig(env:Record<string,string|undefined>=process.env):ImageConfig|null{
 if(env.NAEO_IMAGE_PROVIDER!=='openai')return null;
 const key=env.NAEO_IMAGE_API_KEY??'';
 if(key.length<20)return null;
 const base=env.NAEO_IMAGE_API_BASE;
 let baseUrl='https://api.openai.com';
 if(base){try{const u=new URL(base);const local=u.protocol==='http:'&&['127.0.0.1','localhost','::1'].includes(u.hostname);if(u.protocol!=='https:'&&!local)return null;baseUrl=u.origin+(u.pathname==='/'?'':u.pathname.replace(/\/$/,''));}catch{return null;}}
 const size=(env.NAEO_IMAGE_SIZE||'1024x1024') as ImageConfig['size'];
 return{provider:'openai',apiKey:key,baseUrl,model:env.NAEO_IMAGE_MODEL||'gpt-image-1',size:['1024x1024','1024x1536','1536x1024','1792x1024','1024x1792'].includes(size)?size:'1024x1024'};
}

const boundedBytes=async(response:Response,max:number)=>{
 const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);
 const chunks:Uint8Array[]=[];let total=0;
 try{for(;;){const next=await reader.read();if(next.done)break;total+=next.value.byteLength;if(total>max){await reader.cancel();throw new ProviderError('IMAGE_RESPONSE_TOO_LARGE','AI 이미지 공급자 응답이 너무 큽니다.',false);}chunks.push(next.value);}}
 finally{reader.releaseLock();}
 return Buffer.concat(chunks.map(c=>Buffer.from(c)));
};

const statusError=(status:number,message:string)=>{
 if(status===401||status===403)return new ProviderError('IMAGE_PROVIDER_AUTH','AI 이미지 공급자 인증에 실패했습니다. 관리자에게 키 설정을 확인해달라고 알려주세요.',false);
 if(status===429)return new ProviderError('IMAGE_PROVIDER_BUSY','AI 이미지 공급자 요청 한도에 도달했습니다. 잠시 후 다시 시도합니다.',true);
 if(status>=500)return new ProviderError('IMAGE_PROVIDER_UNAVAILABLE','AI 이미지 공급자가 일시적으로 바쁩니다. 잠시 후 다시 시도합니다.',true);
 if(/content_policy|moderation|safety/i.test(message))return new ProviderError('IMAGE_CONTENT_REJECTED','AI 이미지 공급자가 이 요청을 콘텐츠 정책으로 거절했습니다.',false);
 return new ProviderError('IMAGE_PROVIDER_ERROR',`AI 이미지 공급자 오류(${status})입니다.`,false);
};

/** 인라인 b64 이미지만 받는다(URL 응답은 받지 않아 외부 fetch 경로를 만들지 않는다). */
export function openAIImageProvider(config:ImageConfig,fetchImpl:FetchLike=fetch):ImageProvider{
 return async({prompt})=>{
  const dallE=config.model.startsWith('dall-e');
  let res:Response;
  try{
   res=await fetchImpl(`${config.baseUrl}/v1/images/generations`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(TIMEOUT_MS),
    headers:{'content-type':'application/json',authorization:`Bearer ${config.apiKey}`,accept:'application/json'},
    body:JSON.stringify({model:config.model,prompt,n:1,size:dallE&&config.size.startsWith('1')&&!['1024x1024','1792x1024','1024x1792'].includes(config.size)?'1024x1024':config.size,...(dallE?{response_format:'b64_json',quality:'standard'}:{})})});
  }catch{throw new ProviderError('IMAGE_PROVIDER_UNAVAILABLE','AI 이미지 공급자에 연결하지 못했습니다.',true);}
  const bytes=await boundedBytes(res,MAX_BODY);
  let data:unknown;try{data=JSON.parse(bytes.toString('utf8'));}catch{data=null;}
  const error=data&&typeof data==='object'&&typeof (data as {error?:{message?:unknown}}).error?.message==='string'?(data as {error:{message:string}}).error.message:'';
  if(!res.ok)throw statusError(res.status,error);
  const list=data&&typeof data==='object'?(data as {data?:unknown}).data:null;
  const first=Array.isArray(list)?list[0] as {b64_json?:unknown;url?:unknown}:null;
  if(typeof first?.b64_json!=='string'||!first.b64_json)throw new ProviderError('IMAGE_RESPONSE_INVALID','AI 이미지 공급자가 인라인 이미지를 주지 않았습니다.',false);
  const image=Buffer.from(first.b64_json,'base64');
  if(image.length<32||image.length>MAX_IMAGE_BYTES||!sniffImage(image))throw new ProviderError('IMAGE_RESPONSE_INVALID','AI 이미지 공급자가 JPG/PNG/WEBP가 아닌 데이터를 보냈습니다.',false);
  return image;
 };
}

/** 글 정보로 이미지 프롬프트를 만든다. 회원 입력은 길이를 제한하고 제어문자를 지운다. */
export function buildImagePrompt(input:{keyword:string;title:string;category:string;instructions?:string},index:number){
 const clean=(s:string)=>s.replace(/[^\S\n]+|[^\x20-\uFFFF]/g,' ').trim().slice(0,200);
 const parts=[`"${clean(input.keyword)}" 주제의 네이버 블로그 본문에 어울리는 사진 스타일 이미지`];
 if(clean(input.title))parts.push(`글 제목: "${clean(input.title)}"`);
 if(clean(input.category))parts.push(`분야: ${clean(input.category)}`);
 if(clean(input.instructions??''))parts.push(`요청 분위기: ${clean(input.instructions??'')}`);
 parts.push('사람 얼굴 클로즈업·텍스트·로고·워터마크는 넣지 않는다.',`${index+1}번째 이미지`);
 return parts.join('\n').slice(0,1000);
}
