import {safeNext} from '@/lib/safe-next';
import type {OAuthPrompt,OAuthProviderName} from '@/server/oauth/providers';

const META:Record<OAuthProviderName,{label:string;icon:string;round:boolean}>={
 naver:{label:'네이버로 시작하기',icon:'/assets/6441c55cff8be2eb.PNG',round:true},
 google:{label:'구글로 시작하기',icon:'/assets/756eab3df81c1727.svg',round:false},
};
/** 콜백이 돌려준 오류 코드 → 안내 문구(코드 외의 값은 표시하지 않는다). */
export const OAUTH_ERRORS:Record<string,string>={
 OAUTH_NOT_CONFIGURED:'이 로그인 방식은 아직 설정되지 않았어요(미설정).',
 OAUTH_STATE_INVALID:'로그인 요청이 만료되었거나 다른 브라우저에서 시작됐어요. 다시 시도해주세요.',
 OAUTH_DENIED:'로그인을 취소했거나 권한을 허용하지 않았어요.',
 OAUTH_EMAIL_EXISTS:'이미 이 이메일로 가입한 계정이 있어요. 원래 쓰던 방법(이메일·네이버·구글)으로 로그인한 뒤 설정에서 연결해주세요.',
 OAUTH_EMAIL_REQUIRED:'이메일 제공에 동의해야 가입할 수 있어요. 다시 눌러 이메일 제공을 허용해주세요.',
 OAUTH_EMAIL_UNVERIFIED:'Google에서 확인되지 않은 이메일이라 가입할 수 없어요. 이메일 확인 후 다시 시도해주세요.',
 OAUTH_ALREADY_LINKED:'이 계정은 이미 다른 NAEO 계정에 연결되어 있어요.',
 OAUTH_PROVIDER_LINKED:'같은 서비스의 다른 계정이 이미 연결되어 있어요. 해제 후 다시 연결해주세요.',
 OAUTH_SESSION_CHANGED:'로그인 상태가 바뀌어 연결을 마치지 못했어요. 다시 로그인한 뒤 연결해주세요.',
 ACCOUNT_SUSPENDED:'이용이 정지된 계정이에요.',
 OAUTH_EXCHANGE_FAILED:'로그인 서비스 확인에 실패했어요. 잠시 후 다시 시도해주세요.',
 RATE_LIMITED:'로그인 시도가 너무 많아요. 잠시 후 다시 시도해주세요.',
};
function startHref(provider:OAuthProviderName,next?:string,prompt?:OAuthPrompt):string{
 const q=new URLSearchParams(),clean=next?safeNext(next,''):'';
 if(clean)q.set('next',clean);
 if(prompt)q.set('prompt',prompt);
 const s=q.toString();
 return `/api/auth/oauth/${provider}/start${s?`?${s}`:''}`;
}
export default function SocialLogin({next,configured,error}:{next?:string;configured:Record<OAuthProviderName,boolean>;error?:string}){
 const providers=Object.keys(META) as OAuthProviderName[];
 const naverPrompt:OAuthPrompt|undefined=error==='OAUTH_EMAIL_REQUIRED'?'reprompt':undefined;
 return <div className="login-social" aria-label="간편 로그인">
  {error&&<p role="alert" className="account-error">{OAUTH_ERRORS[error]??'로그인하지 못했어요. 다시 시도해주세요.'}</p>}
  {providers.map(p=>configured[p]
   ?<a key={p} className="login-provider" href={startHref(p,next,p==='naver'?naverPrompt:undefined)} data-oauth={p}><img className={META[p].round?'login-icon-round':'login-icon'} src={META[p].icon} alt="" aria-hidden/>{META[p].label}</a>
   :<button key={p} className="login-provider" type="button" disabled data-oauth={p}><img className={META[p].round?'login-icon-round':'login-icon'} src={META[p].icon} alt="" aria-hidden/>{META[p].label} (미설정)</button>)}
  {configured.naver&&<a className="login-text-btn login-alt-naver" href={startHref('naver',next,'reauthenticate')}>다른 네이버 아이디로 로그인</a>}
 </div>;
}
