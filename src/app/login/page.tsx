import Link from 'next/link';
import { redirect } from 'next/navigation';
import AuthForm from '@/components/account/AuthForm';
import { currentUser } from '@/server/current-user';
import {safeNext} from '@/lib/safe-next';
import SocialLogin from '@/components/account/SocialLogin';
import {oauthConfig} from '@/server/oauth/providers';

export const dynamic='force-dynamic';
export const metadata={title:{absolute:'NAEO: 네이버 AI 검색(AEO) 최적화 진단'}};
export default async function LoginPage({searchParams}:{searchParams:Promise<{next?:string;oauthError?:string}>}) {
  const {next,oauthError}=await searchParams;
  const user=await currentUser();
  if(user)redirect(user.termsAcceptedAt?safeNext(next,'/dashboard/settings'):'/auth/terms');
  return <main className="account-login login-sheet-wrap">
    <Link className="account-logo" href="/">NAEO<span>●</span></Link>
    <section className="login-sheet" aria-labelledby="login-sheet-title">
      <div className="login-sheet-head">
        <h1 id="login-sheet-title">시작하기</h1>
        <Link className="login-close" href="/" aria-label="닫기"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3z" fill="currentColor"/></svg></Link>
      </div>
      <SocialLogin next={next} error={oauthError} configured={{google:oauthConfig('google')!==null,naver:oauthConfig('naver')!==null}}/>
      <p className="login-terms">계속하면 <a href="/terms" target="_blank" rel="noreferrer">이용약관</a> 및 <a href="/privacy" target="_blank" rel="noreferrer">개인정보처리방침</a>에 동의하는 것으로 봅니다.</p>
      <div className="login-email">
        <p className="login-email-label">이메일 로그인</p>
        <AuthForm next={next} variant="sheet"/>
      </div>
    </section>
  </main>;
}
