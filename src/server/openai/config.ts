import {appOrigin} from '../http';

export type OpenAITokenAuthMethod='none'|'client_secret_post'|'client_secret_basic';
export type OpenAIConnectionConfig={
 clientId:string;
 clientSecret:string;
 tokenAuthMethod:OpenAITokenAuthMethod;
 encryptionKey:Buffer;
 issuer:string;
 authorizeEndpoint:string;
 tokenEndpoint:string;
 jwksEndpoint:string;
 revocationEndpoint:string;
 apiBase:string;
 redirectUri:string;
 resource:string;
 scopes:string;
};

const RESOURCE='https://api.openai.com/v1';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const callback=(origin:string)=>`${origin}/api/account/openai/callback`;
const loopback=(u:URL)=>u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname);

/**
 * 배포 서비스용 승인 클라이언트가 전부 설정된 경우에만 연결을 노출한다.
 * 테스트 엔드포인트 대체는 loopback HTTP만 허용한다.
 */
export function openAIConnectionConfig(env:Record<string,string|undefined>=process.env):OpenAIConnectionConfig|null{
 try{
  const clientId=env.NAEO_OPENAI_CLIENT_ID??'';
  if(!/^oaiapp_[A-Za-z0-9_-]{2,180}$/.test(clientId))return null;
  if(!/^[a-f0-9]{64}$/i.test(env.NAEO_OPENAI_TOKEN_ENCRYPTION_KEY??''))return null;
  const origin=new URL(env.NAEO_APP_URL??appOrigin()).origin;
  const redirectUri=env.NAEO_OPENAI_REDIRECT_URI??callback(origin);
  const redirect=new URL(redirectUri);
  if(redirect.origin!==origin||redirect.pathname!=='/api/account/openai/callback'||redirect.search||redirect.hash)return null;
  const secret=env.NAEO_OPENAI_CLIENT_SECRET??'';
  const method=(env.NAEO_OPENAI_TOKEN_AUTH_METHOD??(secret?'client_secret_post':'none')) as OpenAITokenAuthMethod;
  if(!['none','client_secret_post','client_secret_basic'].includes(method)||(method!=='none'&&!secret))return null;
  let issuer='https://auth.openai.com',authorizeEndpoint=`${issuer}/api/accounts/authorize`,tokenEndpoint=`${issuer}/api/accounts/oauth/token`,jwksEndpoint=`${issuer}/.well-known/jwks.json`,revocationEndpoint=`${issuer}/api/accounts/oauth/revoke`,apiBase='https://api.openai.com/v1';
  if(env.NAEO_OPENAI_OAUTH_BASE){
   const base=new URL(env.NAEO_OPENAI_OAUTH_BASE);
   if(!loopback(base)||base.username||base.password||base.search||base.hash||base.pathname!=='/')return null;
   issuer=base.origin;authorizeEndpoint=`${issuer}/authorize`;tokenEndpoint=`${issuer}/token`;jwksEndpoint=`${issuer}/jwks.json`;revocationEndpoint=`${issuer}/revoke`;
  }
  if(env.NAEO_OPENAI_API_BASE){const base=new URL(env.NAEO_OPENAI_API_BASE);if(!loopback(base)||base.username||base.password||base.search||base.hash)return null;apiBase=base.href.replace(/\/$/,'');}
  return{clientId,clientSecret:secret,tokenAuthMethod:method,encryptionKey:Buffer.from(env.NAEO_OPENAI_TOKEN_ENCRYPTION_KEY!,'hex'),issuer,authorizeEndpoint,tokenEndpoint,jwksEndpoint,revocationEndpoint,apiBase,redirectUri,resource:RESOURCE,scopes:SCOPES};
 }catch{return null;}
}
