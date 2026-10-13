import {z} from 'zod';
import {AppError} from '../errors';

export type OAuthProviderName='google'|'naver';
export const PROVIDERS:OAuthProviderName[]=['google','naver'];
export type OAuthProfile={subject:string;email:string|null;emailVerified:boolean;name:string};
type Endpoints={authorize:string;token:string;profile:string};
export type OAuthConfig={name:OAuthProviderName;clientId:string;clientSecret:string;endpoints:Endpoints;pkce:boolean};

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
/** 앱 키가 없으면 null(로그인 버튼은 '미설정'). */
export function oauthConfig(name:OAuthProviderName,env:Record<string,string|undefined>=process.env):OAuthConfig|null{
 const prefix=name==='google'?'NAEO_GOOGLE':'NAEO_NAVER';
 const clientId=env[`${prefix}_CLIENT_ID`],clientSecret=env[`${prefix}_CLIENT_SECRET`];
 if(!clientId||!clientSecret)return null;
 return{name,clientId,clientSecret,endpoints:endpointsFor(name,env.NAEO_OAUTH_ENDPOINT_BASE),pkce:name==='google'};
}

export function authorizeUrl(cfg:OAuthConfig,p:{state:string;challenge:string;nonce:string;redirectUri:string}):string{
 const q=new URLSearchParams({response_type:'code',client_id:cfg.clientId,redirect_uri:p.redirectUri,state:p.state});
 if(cfg.name==='google'){q.set('scope','openid email profile');q.set('code_challenge',p.challenge);q.set('code_challenge_method','S256');q.set('nonce',p.nonce);q.set('prompt','select_account');}
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
const idToken=z.object({iss:z.string(),aud:z.union([z.string(),z.array(z.string())]),sub:z.string().min(1).max(200),exp:z.number(),nonce:z.string().optional(),email:z.string().email().max(254).optional(),email_verified:z.boolean().optional(),name:z.string().max(100).optional()});
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
 if(!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||!aud.includes(cfg.clientId)||claims.exp*1000<=Date.now()||claims.nonce!==p.nonce)throw fail('ID 토큰 검증에 실패했습니다.');
 return{subject:claims.sub,email:claims.email?.toLowerCase()??null,emailVerified:claims.email_verified===true,name:claims.name??claims.email?.split('@')[0]??''};
}
const naverMe=z.object({resultcode:z.string(),response:z.object({id:z.string().min(1).max(200),email:z.string().email().max(254).optional(),nickname:z.string().max(100).optional(),name:z.string().max(100).optional()}).optional()});
/** 네이버: state + 시크릿으로 토큰 교환(PKCE 미지원) 후 회원 프로필 조회. 이메일은 확인 여부를 알 수 없어 미확인으로 둔다. */
async function naver(cfg:OAuthConfig,p:{code:string;state:string;redirectUri:string}):Promise<OAuthProfile>{
 const q=new URLSearchParams({grant_type:'authorization_code',client_id:cfg.clientId,client_secret:cfg.clientSecret,redirect_uri:p.redirectUri,code:p.code,state:p.state});
 const tok=z.object({access_token:z.string()}).safeParse(await getJson(`${cfg.endpoints.token}?${q}`,{method:'GET'}));
 if(!tok.success)throw fail('네이버 토큰을 받지 못했습니다.');
 const me=naverMe.safeParse(await getJson(cfg.endpoints.profile,{headers:{Authorization:`Bearer ${tok.data.access_token}`}}));
 if(!me.success||me.data.resultcode!=='00'||!me.data.response)throw fail('네이버 회원 정보를 받지 못했습니다.');
 const r=me.data.response;
 return{subject:r.id,email:r.email?.toLowerCase()??null,emailVerified:false,name:r.nickname??r.name??''};
}
export function exchange(cfg:OAuthConfig,p:{code:string;state:string;verifier:string;redirectUri:string;nonce:string}):Promise<OAuthProfile>{
 return cfg.name==='google'?google(cfg,p):naver(cfg,p);
}
