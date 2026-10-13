import type {OAuthProviderName} from '@/server/oauth/providers';

const LABEL:Record<OAuthProviderName,string>={google:'Google로 계속하기',naver:'네이버로 계속하기'};
/** 콜백이 돌려준 오류 코드 → 안내 문구(코드 외의 값은 표시하지 않는다). */
export const OAUTH_ERRORS:Record<string,string>={
 OAUTH_NOT_CONFIGURED:'이 로그인 방식은 아직 설정되지 않았어요(미설정).',
 OAUTH_STATE_INVALID:'로그인 요청이 만료되었거나 다른 브라우저에서 시작됐어요. 다시 시도해주세요.',
 OAUTH_DENIED:'로그인을 취소했거나 권한을 허용하지 않았어요.',
 OAUTH_EMAIL_EXISTS:'이미 이 이메일로 가입한 계정이 있어요. 비밀번호로 로그인한 뒤 설정에서 연결해주세요.',
 OAUTH_EMAIL_REQUIRED:'이메일 제공에 동의해야 가입할 수 있어요.',
 OAUTH_ALREADY_LINKED:'이 계정은 이미 다른 NAEO 계정에 연결되어 있어요.',
 OAUTH_PROVIDER_LINKED:'같은 서비스의 다른 계정이 이미 연결되어 있어요. 해제 후 다시 연결해주세요.',
 ACCOUNT_SUSPENDED:'이용이 정지된 계정이에요.',
 OAUTH_EXCHANGE_FAILED:'로그인 서비스 확인에 실패했어요. 잠시 후 다시 시도해주세요.',
};
export default function SocialLogin({next,configured,error}:{next?:string;configured:Record<OAuthProviderName,boolean>;error?:string}){
 const q=next?`?next=${encodeURIComponent(next)}`:'';
 return <div className="account-form" aria-label="간편 로그인">
  {error&&<p role="alert" className="account-error">{OAUTH_ERRORS[error]??'로그인하지 못했어요. 다시 시도해주세요.'}</p>}
  {(Object.keys(LABEL) as OAuthProviderName[]).map(p=>configured[p]
   ?<a key={p} className="button secondary" href={`/api/auth/oauth/${p}/start${q}`} data-oauth={p}>{LABEL[p]}</a>
   :<button key={p} className="button secondary" type="button" disabled data-oauth={p}>{LABEL[p]} (미설정)</button>)}
 </div>;
}
