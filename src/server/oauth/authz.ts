import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {audit} from '../audit';
import {AppError} from '../errors';
import {appOrigin} from '../http';

/** NAEO가 OAuth 2.1 인가 서버, /api/mcp가 리소스 서버. 토큰은 해시로만 저장한다. */
export const SCOPES=['naeo:read','naeo:write','naeo:generate'] as const;
export type Scope=typeof SCOPES[number];
export const SCOPE_LABEL:Record<Scope,string>={'naeo:read':'내 블로그 진단·초안·토큰 잔액 보기','naeo:write':'초안 만들기·고치기','naeo:generate':'토큰을 써서 AI 글 생성 요청'};
export const DEFAULT_SCOPE='naeo:read naeo:write';
export const CODE_TTL=5*60_000,ACCESS_TTL=3600_000,REFRESH_TTL=30*86_400_000;
export const mcpResource=()=>`${appOrigin()}/api/mcp`;
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const secret=(prefix:string)=>`${prefix}${randomBytes(32).toString('base64url')}`;
const oauthError=(status:number,code:string,message:string)=>new AppError(status,code,message);

const BLOCKED_SCHEMES=['javascript:','data:','file:','vbscript:','about:','blob:','ftp:','ws:','wss:'];
/** 등록 가능한 리디렉션: https, 루프백 http(RFC 8252), 또는 앱 전용 스킴(위험 스킴 제외). */
export function allowedRedirect(raw:string):boolean{
 let u:URL;
 try{u=new URL(raw);}catch{return false;}
 if(raw.length>500||u.hash||u.username||u.password)return false;
 if(u.protocol==='https:')return true;
 if(u.protocol==='http:')return['127.0.0.1','localhost','[::1]'].includes(u.hostname);
 return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol)&&!BLOCKED_SCHEMES.includes(u.protocol);
}
type ClientRow={client_id:string;name:string;kind:'mcp'|'extension';redirect_uris_json:string};
function clientById(db:Database,id:string):ClientRow|undefined{return db.prepare('SELECT client_id,name,kind,redirect_uris_json FROM oauth_clients WHERE client_id=?').get(id) as ClientRow|undefined;}
const view=(c:ClientRow,at:number)=>({client_id:c.client_id,client_name:c.name,redirect_uris:JSON.parse(c.redirect_uris_json) as string[],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',client_id_issued_at:Math.floor(at/1000)});

const registration=z.object({client_name:z.string().trim().min(1).max(80),redirect_uris:z.array(z.string()).min(1).max(5),token_endpoint_auth_method:z.literal('none').optional()}).passthrough();
/** 동적 클라이언트 등록(RFC 7591): 공개 클라이언트(시크릿 없음, PKCE 필수). */
export function registerClient(db:Database,input:unknown,now=Date.now()){
 const v=registration.safeParse(input);
 if(!v.success)throw oauthError(400,'invalid_client_metadata','client_name과 redirect_uris가 필요합니다(시크릿 없는 공개 클라이언트만 지원).');
 if(!v.data.redirect_uris.every(allowedRedirect))throw oauthError(400,'invalid_redirect_uri','https, 루프백 http, 앱 전용 스킴만 등록할 수 있습니다.');
 const id=randomBytes(18).toString('base64url');
 db.prepare("INSERT INTO oauth_clients(client_id,name,kind,redirect_uris_json,created_at) VALUES(?,?,'mcp',?,?)").run(id,v.data.client_name,JSON.stringify(v.data.redirect_uris),now);
 audit(db,null,'oauth.client.register','oauth_client',id,{name:v.data.client_name});
 return view(clientById(db,id)!,now);
}
/** 크롬 확장(chrome.identity) 클라이언트: 확장 ID마다 하나, 리디렉션은 https://{id}.chromiumapp.org/ 고정. */
export function ensureExtensionClient(db:Database,extensionId:string,now=Date.now()){
 if(!/^[a-p]{32}$/.test(extensionId))throw new AppError(400,'INVALID_EXTENSION','확장 프로그램 ID가 올바르지 않습니다.');
 const id=`naeo-extension-${extensionId}`;
 db.prepare("INSERT INTO oauth_clients(client_id,name,kind,redirect_uris_json,created_at) VALUES(?,'NAEO 확장 프로그램','extension',?,?) ON CONFLICT(client_id) DO NOTHING").run(id,JSON.stringify([`https://${extensionId}.chromiumapp.org/`]),now);
 return view(clientById(db,id)!,now);
}

const authorizeShape=z.object({response_type:z.string().optional(),client_id:z.string().max(80).optional(),redirect_uri:z.string().max(500).optional(),state:z.string().max(500).optional(),
 code_challenge:z.string().max(200).optional(),code_challenge_method:z.string().max(20).optional(),scope:z.string().max(200).optional(),resource:z.string().max(300).optional()}).passthrough();
export type AuthorizeRequest={clientId:string;clientName:string;kind:'mcp'|'extension';redirectUri:string;state:string;scope:string;scopes:Scope[];resource:string;challenge:string;method:string;responseType:string};
/** 클라이언트·리디렉션이 틀리면 앱으로 돌려보내지 않고 화면에 오류를 보여준다(오픈 리디렉트 방지). */
export function validateAuthorizeRequest(db:Database,input:unknown):AuthorizeRequest{
 const v=authorizeShape.parse(input);
 const client=v.client_id?clientById(db,v.client_id):undefined;
 if(!client)throw new AppError(400,'INVALID_CLIENT','등록되지 않은 앱입니다.');
 const uris=JSON.parse(client.redirect_uris_json) as string[];
 if(!v.redirect_uri||!uris.includes(v.redirect_uri))throw new AppError(400,'INVALID_REDIRECT','앱의 돌아갈 주소가 등록된 주소와 다릅니다.');
 const scope=(v.scope??'').trim()||DEFAULT_SCOPE;
 return{clientId:client.client_id,clientName:client.name,kind:client.kind,redirectUri:v.redirect_uri,state:v.state??'',scope,scopes:scope.split(/\s+/) as Scope[],resource:v.resource||mcpResource(),challenge:v.code_challenge??'',method:v.code_challenge_method??'',responseType:v.response_type??''};
}
/** 앱으로 돌려보낼 요청 오류(RFC 6749 4.1.2.1 코드). 없으면 null. */
export function requestProblem(r:AuthorizeRequest):string|null{
 if(r.responseType!=='code'||r.method!=='S256'||!/^[A-Za-z0-9_-]{43,128}$/.test(r.challenge))return 'invalid_request';
 if(!r.scopes.every(s=>(SCOPES as readonly string[]).includes(s)))return 'invalid_scope';
 if(r.resource!==mcpResource())return 'invalid_target';
 return null;
}
const back=(r:AuthorizeRequest,q:Record<string,string>)=>{const u=new URL(r.redirectUri);for(const [k,v] of Object.entries({...q,...(r.state?{state:r.state}:{})}))u.searchParams.set(k,v);return u.toString();};
/** 동의 결정: 승인하면 5분짜리 일회 코드(해시 저장)를 붙여 앱으로 돌려보낸다. */
export function decideAuthorization(db:Database,userId:string,input:unknown,now=Date.now()):string{
 const r=validateAuthorizeRequest(db,input);
 const problem=requestProblem(r);
 if(problem)return back(r,{error:problem});
 if((input as {decision?:string}).decision!=='approve')return back(r,{error:'access_denied'});
 const code=secret('naeo_code_');
 db.prepare('INSERT INTO oauth_codes(code_hash,client_id,user_id,redirect_uri,code_challenge,scope,resource,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(sha(code),r.clientId,userId,r.redirectUri,r.challenge,r.scope,r.resource,now+CODE_TTL,now);
 audit(db,userId,'oauth.authorize','oauth_client',r.clientId,{scope:r.scope});
 return back(r,{code});
}

function issue(db:Database,g:{clientId:string;userId:string;scope:string;resource:string;family:string},now:number){
 const access=secret('naeo_at_'),refresh=secret('naeo_rt_');
 const insert=db.prepare('INSERT INTO oauth_tokens(token_hash,kind,client_id,user_id,scope,resource,family_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
 insert.run(sha(access),'access',g.clientId,g.userId,g.scope,g.resource,g.family,now+ACCESS_TTL,now);
 insert.run(sha(refresh),'refresh',g.clientId,g.userId,g.scope,g.resource,g.family,now+REFRESH_TTL,now);
 db.prepare('UPDATE oauth_clients SET last_used_at=? WHERE client_id=?').run(now,g.clientId);
 return{access_token:access,token_type:'Bearer' as const,expires_in:ACCESS_TTL/1000,refresh_token:refresh,scope:g.scope};
}
const tokenInput=z.object({grant_type:z.string(),code:z.string().max(200).optional(),redirect_uri:z.string().max(500).optional(),client_id:z.string().max(80).optional(),code_verifier:z.string().max(128).optional(),refresh_token:z.string().max(200).optional(),resource:z.string().max(300).optional()}).passthrough();
const invalidGrant=(m:string)=>oauthError(400,'invalid_grant',m);
/** 토큰 엔드포인트: authorization_code(PKCE·리디렉션·대상 대조, 성공해야 코드 소비)와 refresh_token(회전, 재사용 시 계열 전체 철회). */
export function exchangeToken(db:Database,input:unknown,now=Date.now()){
 const v=tokenInput.safeParse(input);
 if(!v.success)throw oauthError(400,'invalid_request','요청 형식이 올바르지 않습니다.');
 const f=v.data;
 const result=transaction(db,()=>{
  if(f.grant_type==='authorization_code'){
   const c=db.prepare('SELECT client_id AS clientId,user_id AS userId,redirect_uri AS redirectUri,code_challenge AS challenge,scope,resource,expires_at AS expiresAt FROM oauth_codes WHERE code_hash=?').get(sha(f.code??'')) as {clientId:string;userId:string;redirectUri:string;challenge:string;scope:string;resource:string;expiresAt:number}|undefined;
   if(!c||c.expiresAt<=now||c.clientId!==f.client_id||c.redirectUri!==f.redirect_uri)throw invalidGrant('코드가 없거나 만료되었습니다.');
   if(!f.code_verifier||createHash('sha256').update(f.code_verifier).digest('base64url')!==c.challenge)throw invalidGrant('PKCE 검증에 실패했습니다.');
   if(f.resource&&f.resource!==c.resource)throw oauthError(400,'invalid_target','대상이 인가 요청과 다릅니다.');
   db.prepare('DELETE FROM oauth_codes WHERE code_hash=?').run(sha(f.code!));
   return issue(db,{clientId:c.clientId,userId:c.userId,scope:c.scope,resource:c.resource,family:randomUUID()},now);
  }
  if(f.grant_type==='refresh_token'){
   const t=db.prepare("SELECT client_id AS clientId,user_id AS userId,scope,resource,family_id AS family,expires_at AS expiresAt,revoked_at AS revokedAt FROM oauth_tokens WHERE token_hash=? AND kind='refresh'").get(sha(f.refresh_token??'')) as {clientId:string;userId:string;scope:string;resource:string;family:string;expiresAt:number;revokedAt:number|null}|undefined;
   if(!t||t.clientId!==f.client_id)throw invalidGrant('리프레시 토큰이 올바르지 않습니다.');
   // 재사용 감지: 계열 철회는 커밋되어야 하므로 오류는 트랜잭션 밖에서 던진다.
   if(t.revokedAt!==null){db.prepare('UPDATE oauth_tokens SET revoked_at=coalesce(revoked_at,?) WHERE family_id=?').run(now,t.family);audit(db,t.userId,'oauth.refresh.reuse','oauth_client',t.clientId);return{reused:true as const};}
   if(t.expiresAt<=now)throw invalidGrant('리프레시 토큰이 만료되었습니다.');
   db.prepare('UPDATE oauth_tokens SET revoked_at=? WHERE token_hash=?').run(now,sha(f.refresh_token!));
   db.prepare("UPDATE oauth_tokens SET revoked_at=coalesce(revoked_at,?) WHERE family_id=? AND kind='access'").run(now,t.family);
   return issue(db,t,now);
  }
  throw oauthError(400,'unsupported_grant_type','지원하지 않는 grant_type입니다.');
 });
 if('reused' in result)throw invalidGrant('이미 사용한 리프레시 토큰입니다. 다시 연결해주세요.');
 return result;
}

/** /api/mcp 접근 토큰 확인: 접근 토큰·미철회·미만료·대상 일치·활성 회원. */
export function authenticateBearer(db:Database,header:string|null|undefined,resource:string,now=Date.now()){
 const raw=/^Bearer\s+(\S+)$/i.exec(header??'')?.[1];
 const t=raw?db.prepare("SELECT t.client_id AS clientId,t.user_id AS userId,t.scope,t.resource,t.expires_at AS expiresAt,t.revoked_at AS revokedAt,u.status FROM oauth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.kind='access'").get(sha(raw)) as {clientId:string;userId:string;scope:string;resource:string;expiresAt:number;revokedAt:number|null;status:string}|undefined:undefined;
 if(!t||t.revokedAt!==null||t.expiresAt<=now||t.resource!==resource||t.status!=='active')throw new AppError(401,raw?'invalid_token':'unauthorized',raw?'토큰이 만료되었거나 철회되었습니다.':'인증이 필요합니다.');
 db.prepare('UPDATE oauth_tokens SET last_used_at=? WHERE token_hash=?').run(now,sha(raw!));
 return{userId:t.userId,clientId:t.clientId,scopes:t.scope.split(' ') as Scope[]};
}
/** RFC 7009: 어떤 토큰이든 철회(리프레시면 계열 전체). 없는 토큰도 성공으로 응답. */
export function revokeToken(db:Database,input:unknown,now=Date.now()){
 const token=z.object({token:z.string().max(200)}).passthrough().safeParse(input);
 if(!token.success)return{revoked:false};
 const t=db.prepare('SELECT kind,family_id AS family FROM oauth_tokens WHERE token_hash=?').get(sha(token.data.token)) as {kind:string;family:string}|undefined;
 if(t)db.prepare(`UPDATE oauth_tokens SET revoked_at=coalesce(revoked_at,?) WHERE ${t.kind==='refresh'?'family_id=?':'token_hash=?'}`).run(now,t.kind==='refresh'?t.family:sha(token.data.token));
 return{revoked:true};
}
export function revokeAppForUser(db:Database,userId:string,clientId:string,now=Date.now()){
 const r=db.prepare('UPDATE oauth_tokens SET revoked_at=coalesce(revoked_at,?) WHERE user_id=? AND client_id=?').run(now,userId,clientId);
 if(!r.changes)throw new AppError(404,'NOT_FOUND','연결된 앱이 없습니다.');
 audit(db,userId,'oauth.app.revoke','oauth_client',clientId);
 return{revoked:true};
}
export type AuthorizedApp={clientId:string;name:string;kind:'mcp'|'extension';scopes:Scope[];connectedAt:number;lastUsedAt:number|null;calls:number};
/** 연결된 앱: 유효한 리프레시 토큰이 남아 있는 클라이언트. */
export function listAuthorizedApps(db:Database,userId:string,now=Date.now()):AuthorizedApp[]{
 const rows=db.prepare(`SELECT c.client_id AS clientId,c.name,c.kind,max(t.scope) AS scope,min(t.created_at) AS connectedAt,max(t.last_used_at) AS lastUsedAt,
  (SELECT count(*) FROM mcp_calls m WHERE m.user_id=t.user_id AND m.client_id=c.client_id) AS calls
  FROM oauth_tokens t JOIN oauth_clients c ON c.client_id=t.client_id WHERE t.user_id=? AND t.kind='refresh' AND t.revoked_at IS NULL AND t.expires_at>? GROUP BY c.client_id ORDER BY connectedAt`).all(userId,now) as (Omit<AuthorizedApp,'scopes'>&{scope:string})[];
 return rows.map(({scope,...r})=>({...r,scopes:scope.split(' ') as Scope[]}));
}
