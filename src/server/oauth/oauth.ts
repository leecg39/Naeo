import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {createSession,hashPassword,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {appOrigin} from '../http';
import {password} from '../validation';
import {safeNext} from '../../lib/safe-next';
import {authorizeUrl,exchange,oauthConfig,type OAuthProfile,type OAuthProviderName} from './providers';

export const STATE_TTL=10*60_000;
export const REAUTH_WINDOW=10*60_000;
/** OAuth 가입 회원의 비밀번호 칸: scrypt 형식이 아니라 비밀번호 로그인이 항상 실패한다. */
export const NO_PASSWORD='!oauth';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const token=(bytes=32)=>randomBytes(bytes).toString('base64url');
export const redirectUri=(p:OAuthProviderName)=>`${appOrigin()}/api/auth/oauth/${p}/callback`;
export type Connection={provider:OAuthProviderName;email:string;createdAt:number;lastLoginAt:number|null};

/**
 * 로그인·연결 시작: 일회 state(해시 저장)·PKCE verifier·nonce를 만들고, state를 이 브라우저 쿠키(binding)에 묶는다.
 * 키가 없으면 아무것도 저장하지 않고 503.
 */
export function startOAuth(db:Database,provider:OAuthProviderName,opts:{intent:'login'|'link';userId?:string;next?:string},now=Date.now()){
 const cfg=oauthConfig(provider);
 if(!cfg)throw new AppError(503,'OAUTH_NOT_CONFIGURED',`${provider==='google'?'Google':'네이버'} 로그인이 아직 설정되지 않았습니다(미설정).`);
 const state=token(),binding=token(),verifier=token(48),nonce=token(16);
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 const next=safeNext(opts.next,opts.intent==='link'?'/dashboard/settings':'/dashboard');
 transaction(db,()=>{
  db.prepare('DELETE FROM oauth_states WHERE expires_at<=?').run(now);
  db.prepare('INSERT INTO oauth_states(state_hash,provider,intent,user_id,binding_hash,code_verifier,nonce,next,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run(sha(state),provider,opts.intent,opts.userId??null,sha(binding),verifier,nonce,next,now+STATE_TTL,now);
 });
 return{url:authorizeUrl(cfg,{state,challenge,nonce,redirectUri:redirectUri(provider)}),binding};
}

type Pending={provider:OAuthProviderName;intent:'login'|'link';userId:string|null;bindingHash:string;verifier:string;nonce:string;next:string;expiresAt:number};
/** state 확인: 같은 브라우저(binding)일 때만 꺼내며 꺼내는 순간 지워 한 번만 쓰인다. */
function takeState(db:Database,provider:OAuthProviderName,state:string,binding:string|undefined,now:number):Pending{
 return transaction(db,()=>{
  const row=db.prepare('SELECT provider,intent,user_id AS userId,binding_hash AS bindingHash,code_verifier AS verifier,nonce,next,expires_at AS expiresAt FROM oauth_states WHERE state_hash=?').get(sha(state)) as Pending|undefined;
  if(!row||row.provider!==provider||!binding||row.bindingHash!==sha(binding))throw new AppError(400,'OAUTH_STATE_INVALID','로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해주세요.');
  db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(sha(state));
  if(row.expiresAt<=now)throw new AppError(400,'OAUTH_STATE_INVALID','로그인 요청이 만료되었습니다. 다시 시도해주세요.');
  return{...row};
 });
}

function linkTo(db:Database,provider:OAuthProviderName,userId:string,profile:OAuthProfile,now:number){
 const owner=db.prepare('SELECT user_id AS userId FROM oauth_accounts WHERE provider=? AND subject=?').get(provider,profile.subject) as {userId:string}|undefined;
 if(owner&&owner.userId!==userId)throw new AppError(409,'OAUTH_ALREADY_LINKED','이 계정은 이미 다른 NAEO 계정에 연결되어 있습니다.');
 if(!owner&&db.prepare('SELECT 1 FROM oauth_accounts WHERE user_id=? AND provider=?').get(userId,provider))throw new AppError(409,'OAUTH_PROVIDER_LINKED','이미 같은 서비스의 다른 계정이 연결되어 있습니다. 해제 후 다시 연결해주세요.');
 if(!owner)db.prepare('INSERT INTO oauth_accounts(provider,subject,user_id,email,created_at) VALUES(?,?,?,?,?)').run(provider,profile.subject,userId,profile.email??'',now);
 audit(db,userId,'account.oauth.link','user',userId,{provider});
}
function createOAuthUser(db:Database,provider:OAuthProviderName,profile:OAuthProfile,now:number):string{
 if(!profile.email)throw new AppError(400,'OAUTH_EMAIL_REQUIRED','이메일 제공에 동의해야 가입할 수 있습니다. 다시 시도해 이메일 제공을 허용해주세요.');
 if(db.prepare('SELECT 1 FROM users WHERE email=?').get(profile.email))throw new AppError(409,'OAUTH_EMAIL_EXISTS','이미 이 이메일로 가입한 계정이 있습니다. 비밀번호로 로그인한 뒤 설정에서 연결해주세요.');
 const id=randomUUID(),nickname=(profile.name.trim()||'NAEO 회원').slice(0,30);
 db.prepare('INSERT INTO users(id,email,password_hash,terms_accepted_at,email_verified_at,created_at,updated_at) VALUES(?,?,?,0,?,?,?)').run(id,profile.email,NO_PASSWORD,profile.emailVerified?now:null,now,now);
 db.prepare('INSERT INTO profiles(user_id,nickname,updated_at) VALUES(?,?,?)').run(id,nickname,now);
 db.prepare('INSERT INTO notification_preferences(user_id,updated_at) VALUES(?,?)').run(id,now);
 db.prepare('INSERT INTO oauth_accounts(provider,subject,user_id,email,created_at) VALUES(?,?,?,?,?)').run(provider,profile.subject,id,profile.email,now);
 audit(db,id,'account.register','user',id,{provider});
 return id;
}

const callbackInput=z.object({code:z.string().min(1).max(2000).optional(),state:z.string().min(1).max(200),error:z.string().max(100).optional()});
/**
 * 콜백: state 확인 → 코드 교환(구글 PKCE·nonce) → 연결 또는 로그인/가입.
 * 같은 이메일의 기존 계정에는 자동 연결하지 않는다(계정 탈취 방지). 새 회원은 약관 동의 후 이용.
 */
export async function completeOAuth(db:Database,provider:OAuthProviderName,input:unknown,binding:string|undefined,now=Date.now()){
 const v=callbackInput.parse(input);
 const pending=takeState(db,provider,v.state,binding,now);
 if(v.error||!v.code)throw new AppError(400,'OAUTH_DENIED','로그인을 취소했거나 권한을 허용하지 않았습니다.');
 const cfg=oauthConfig(provider);
 if(!cfg)throw new AppError(503,'OAUTH_NOT_CONFIGURED','로그인 설정이 없습니다(미설정).');
 const profile=await exchange(cfg,{code:v.code,state:v.state,verifier:pending.verifier,redirectUri:redirectUri(provider),nonce:pending.nonce});
 return transaction(db,()=>{
  if(pending.intent==='link'){
   const user=userById(db,pending.userId!);
   if(user.status!=='active')throw new AppError(403,'ACCOUNT_SUSPENDED','이용이 정지된 계정입니다.');
   linkTo(db,provider,user.id,profile,now);
   return{kind:'linked' as const,userId:user.id,next:pending.next,needsTerms:false};
  }
  const existing=db.prepare('SELECT user_id AS userId FROM oauth_accounts WHERE provider=? AND subject=?').get(provider,profile.subject) as {userId:string}|undefined;
  const userId=existing?.userId??createOAuthUser(db,provider,profile,now);
  const user=userById(db,userId);
  if(user.status!=='active')throw new AppError(403,'ACCOUNT_SUSPENDED','이용이 정지된 계정입니다.');
  db.prepare('UPDATE oauth_accounts SET last_login_at=? WHERE provider=? AND subject=?').run(now,provider,profile.subject);
  const session=createSession(db,userId);
  audit(db,userId,'account.login','user',userId,{provider});
  return{kind:'login' as const,userId,next:pending.next,needsTerms:!user.termsAcceptedAt,session};
 });
}

export const listConnections=(db:Database,userId:string):Connection[]=>(db.prepare('SELECT provider,email,created_at AS createdAt,last_login_at AS lastLoginAt FROM oauth_accounts WHERE user_id=? ORDER BY provider').all(userId) as Connection[]).map(c=>({...c}));
export const hasPassword=(db:Database,userId:string)=>(db.prepare('SELECT password_hash AS h FROM users WHERE id=?').get(userId) as {h:string}).h.startsWith('scrypt$');

/** 연결 해제: 비밀번호도 없고 다른 연결도 없으면 로그인할 방법이 사라지므로 거절. */
export function unlinkProvider(db:Database,userId:string,provider:OAuthProviderName){
 return transaction(db,()=>{
  if(!db.prepare('SELECT 1 FROM oauth_accounts WHERE user_id=? AND provider=?').get(userId,provider))throw new AppError(404,'NOT_FOUND','연결된 계정이 없습니다.');
  const others=(db.prepare('SELECT count(*) AS n FROM oauth_accounts WHERE user_id=? AND provider<>?').get(userId,provider) as {n:number}).n;
  if(!hasPassword(db,userId)&&others===0)throw new AppError(409,'LAST_LOGIN_METHOD','유일한 로그인 방법이라 해제할 수 없습니다. 먼저 비밀번호를 설정해주세요.');
  db.prepare('DELETE FROM oauth_accounts WHERE user_id=? AND provider=?').run(userId,provider);
  audit(db,userId,'account.oauth.unlink','user',userId,{provider});
  return{unlinked:true};
 });
}

const initialPasswordInput=z.object({newPassword:password}).strict();
/** OAuth로만 가입한 회원의 첫 비밀번호: 로그인한 지 10분 안의 세션에서만(최근 인증). 이후 탈퇴·해제에 쓴다. */
export function setInitialPassword(db:Database,userId:string,sessionCreatedAt:number,input:unknown,now=Date.now()){
 const {newPassword}=initialPasswordInput.parse(input);
 if(hasPassword(db,userId))throw new AppError(409,'PASSWORD_ALREADY_SET','이미 비밀번호가 있습니다. 비밀번호 변경을 이용해주세요.');
 if(now-sessionCreatedAt>REAUTH_WINDOW)throw new AppError(403,'REAUTH_REQUIRED','보안을 위해 다시 로그인한 뒤 10분 안에 설정해주세요.');
 return hashPassword(newPassword).then(hash=>transaction(db,()=>{
  db.prepare("UPDATE users SET password_hash=?,version=version+1,updated_at=? WHERE id=? AND password_hash NOT LIKE 'scrypt$%'").run(hash,now,userId);
  audit(db,userId,'account.password.initial','user',userId);
  return{passwordSet:true};
 }));
}
