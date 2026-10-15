import Link from 'next/link';
import {ForgotPasswordForm} from '@/components/account/AccountMailForms';
import {mailConfig} from '@/server/mail/provider';
export const dynamic='force-dynamic';
export const metadata={title:'비밀번호 재설정 안내',referrer:'no-referrer' as const,robots:{index:false,follow:false}};
export default function ForgotPasswordPage(){return <main className="account-login"><Link className="account-logo" href="/">NAEO<span>●</span></Link><section className="panel account-card"><h1 className="page-heading">비밀번호를 잊으셨나요?</h1><ForgotPasswordForm available={mailConfig()!==null}/></section></main>;}
