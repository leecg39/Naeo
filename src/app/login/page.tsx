import Link from 'next/link';
import { redirect } from 'next/navigation';
import AuthForm from '@/components/account/AuthForm';
import { currentUser } from '@/server/current-user';

export const dynamic='force-dynamic';
export default async function LoginPage({searchParams}:{searchParams:Promise<{next?:string}>}) {
  const {next}=await searchParams;
  if(await currentUser()) redirect('/dashboard/settings');
  return <main className="account-login"><Link className="account-logo" href="/">NAEO<span>●</span></Link><div className="panel account-card"><p className="eyebrow">WELCOME TO NAEO</p><h1 className="page-heading">내 블로그의 다음 단계</h1><p className="muted">계정에 로그인하고 블로그를 관리하세요.</p><AuthForm next={next}/></div><Link className="muted" href="/">← 홈으로 돌아가기</Link></main>;
}
