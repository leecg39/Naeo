import {z} from 'zod';
import {AppError} from '../errors';

export type OAuthProviderName='google'|'naver';
export const PROVIDERS:OAuthProviderName[]=['google','naver'];
export type OAuthProfile={subject:string;email:string|null;emailVerified:boolean;name:string};
type Endpoints={authorize:string;token:string;profile:string};
export type OAuthConfig={name:OAuthProviderName;clientId:string;clientSecret:string;endpoints:Endpoints;pkce:boolean};
/** 네이버 로그인 화면 재요청: reauthenticate=다른 아이디로 다시 로그인, reprompt=제공 정보 동의 다시 받기. */
export type OAuthPrompt='reauthenticate'|'reprompt';
export const PROMPTS:OAuthPrompt[]=['reauthenticate','reprompt'];

/** 공식 엔드포인트(구글: OIDC discovery, 네이버: 로그인 API 명세). */
const OFFICIAL:Record<OAuthProviderName,Endpoints>={
 google:{authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',profile:'https://openidconnect.googleapis.com/v1/userinfo'},
 naver:{authorize:'https://nid.naver.com/oauth2.0/authorize',token:'https://nid.naver.com/oauth2.0/token',profile:'https://openapi.naver.com/v1/nid/me'},
};
/** 로컬 검증용 대체 주소(localhost http만). 운영에서는 설정하지 않는다. */
function endpointsFor(name:OAuthProviderName,base:string|undefined):Endpoints{
 if(!base)return OFFICIAL[name];
 const u=new URL(base);
 if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname))throw new Error('NAEO_OAUTH_ENDPOINT_BASE is for local checks only (http://localhost)');
 return{authorize:`${u.origin}/${name}/authorize`,token:`${u.origin}/${name}/token`,profile:`${u.origin}/${name}/me`};
}
/**
 * 환경변수 이름. 네이버 로그인은 네이버 검색 API(NAEO_NAVER_CLIENT_*)와 다른 변수를 쓴다:
 * 검색 키만 넣었는데 로그인 버튼이 켜지거나, 로그인 앱 키가 검색 API 호출에 쓰이는 일을 막는다.
 */
export const OAUTH_ENV:Record<OAuthProviderName,{id:string;secret:string}>={
 google:{id:'NAEO_GOOGLE_CLIENT_ID',secret:'NAEO_GOOGLE_CLIENT_SECRET'},
 naver:{id:'NAEO_NAVER_OAUTH_CLIENT_ID',secret:'NAEO_NAVER_OAUTH_CLIENT_SECRET'},
};
/** 앱 키가 없으면 null(로그인 버튼은 '미설정'). */
export function oauthConfig(name:OAuthProviderName,env:Record<string,string|undefined>=process.env):OAuthConfig|null{
 const clientId=env[OAUTH_ENV[name].id],clientSecret=env[OAUTH_ENV[name].secret];
 if(!clientId||!clientSecret)return null;
 return{name,clientId,clientSecret,endpoints:endpointsFor(name,env.NAEO_OAUTH_ENDPOINT_BASE),pkce:name==='google'};
}

export function authorizeUrl(cfg:OAuthConfig,p:{state:string;challenge:string;nonce:string;redirectUri:string;prompt?:OAuthPrompt}):string{
 const q=new URLSearchParams({response_type:'code',client_id:cfg.clientId,redirect_uri:p.redirectUri,state:p.state});
 if(cfg.name==='google'){q.set('scope','openid email profile');q.set('code_challenge',p.challenge);q.set('code_challenge_method','S256');q.set('nonce',p.nonce);q.set('prompt','select_account');}
 if(cfg.name==='naver'&&p.prompt)q.set('auth_type',p.prompt);
 return `${cfg.endpoints.authorize}?${q}`;
}

const fail=(message:string)=>new AppError(502,'OAUTH_EXCHANGE_FAILED',message);
async function getJson(url:string,init:RequestInit):Promise<unknown>{
 let r:Response;
 try{r=await fetch(url,{...init,signal:AbortSignal.timeout(10_000),redirect:'error'});}catch{throw fail('로그인 서비스에 연결하지 못했습니다.');}
 const body=await r.json().catch(()=>null);
 if(!r.ok||body===null)throw fail('로그인 서비스가 요청을 거절했습니다.');
 return body;
}
/** 형식이 이상한 이메일은 로그인 자체를 막지 않고 '없음'으로 본다(이미 연결된 회원은 subject로 로그인). */
const emailOf=(v:unknown)=>{const r=z.string().trim().toLowerCase().email().max(254).safeParse(v);return r.success?r.data:null;};
const nameOf=(...vs:unknown[])=>{for(const v of vs)if(typeof v==='string'&&v.trim())return v.trim().slice(0,100);return '';};
const idToken=z.object({iss:z.string(),aud:z.union([z.string(),z.array(z.string())]),azp:z.string().optional(),sub:z.string().min(1).max(200),exp:z.number(),nonce:z.string().optional(),email:z.unknown().optional(),email_verified:z.unknown().optional(),name:z.unknown().optional()});
/**
 * 구글: 토큰 엔드포인트에서 TLS로 직접 받은 ID 토큰이라 서명 대신 발급자·대상·만료·nonce를 확인한다(OIDC Core 3.1.3.7).
 */
async function google(cfg:OAuthConfig,p:{code:string;verifier:string;redirectUri:string;nonce:string}):Promise<OAuthProfile>{
 const body=new URLSearchParams({code:p.code,client_id:cfg.clientId,client_secret:cfg.clientSecret,redirect_uri:p.redirectUri,grant_type:'authorization_code',code_verifier:p.verifier});
 const tok=z.object({id_token:z.string()}).safeParse(await getJson(cfg.endpoints.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body}));
 if(!tok.success)throw fail('ID 토큰이 없습니다.');
 let claims:z.infer<typeof idToken>;
 try{claims=idToken.parse(JSON.parse(Buffer.from(tok.data.id_token.split('.')[1]??'','base64url').toString('utf8')));}catch{throw fail('ID 토큰을 해석하지 못했습니다.');}
 const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 const azpOk=claims.azp===undefined?aud.length===1:claims.azp===cfg.clientId;
 if(!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||!aud.includes(cfg.clientId)||!azpOk||claims.exp*1000<=Date.now()||claims.nonce!==p.nonce)throw fail('ID 토큰 검증에 실패했습니다.');
 const email=emailOf(claims.email);
 return{subject:claims.sub,email,emailVerified:email!==null&&claims.email_verified===true,name:nameOf(claims.name,email?.split('@')[0])};
}
const naverMe=z.object({resultcode:z.string(),response:z.object({id:z.string().min(1).max(200),email:z.unknown().optional(),nickname:z.unknown().optional(),name:z.unknown().optional()}).optional()});
/** 네이버: state + 시크릿으로 토큰 교환(PKCE 미지원, 시크릿이 URL·로그에 남지 않게 POST 본문) 후 회원 프로필 조회. 이메일은 확인 여부를 알 수 없어 미확인으로 둔다. */
async function naver(cfg:OAuthConfig,p:{code:string;state:string;redirectUri:string}):Promise<OAuthProfile>{
 const body=new URLSearchParams({grant_type:'authorization_code',client_id:cfg.clientId,client_secret:cfg.clientSecret,redirect_uri:p.redirectUri,code:p.code,state:p.state});
 const tok=z.object({access_token:z.string()}).safeParse(await getJson(cfg.endpoints.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body}));
 if(!tok.success)throw fail('네이버 토큰을 받지 못했습니다.');
 const me=naverMe.safeParse(await getJson(cfg.endpoints.profile,{headers:{Authorization:`Bearer ${tok.data.access_token}`}}));
 if(!me.success||me.data.resultcode!=='00'||!me.data.response)throw fail('네이버 회원 정보를 받지 못했습니다.');
 const r=me.data.response;
 return{subject:r.id,email:emailOf(r.email),emailVerified:false,name:nameOf(r.nickname,r.name)};
}
export function exchange(cfg:OAuthConfig,p:{code:string;state:string;verifier:string;redirectUri:string;nonce:string}):Promise<OAuthProfile>{
 return cfg.name==='google'?google(cfg,p):naver(cfg,p);
}
