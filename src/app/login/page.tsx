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
  return <main className="account-login"><Link className="account-logo" href="/">NAEO<span>●</span></Link><div className="panel account-card"><p className="eyebrow">WELCOME TO NAEO</p><h1 className="page-heading">내 블로그의 다음 단계</h1><p className="muted">계정에 로그인하고 블로그를 관리하세요.</p><SocialLogin next={next} error={oauthError} configured={{google:oauthConfig('google')!==null,naver:oauthConfig('naver')!==null}}/><AuthForm next={next}/></div><Link className="muted" href="/">← 홈으로 돌아가기</Link></main>;
}
