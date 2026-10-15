import {EmailLinkForm} from '@/components/account/AccountMailForms';
export const metadata={title:'이메일 주소 확인',referrer:'no-referrer' as const,robots:{index:false,follow:false}};
export default function VerifyEmailPage(){return <main className="account-login"><section className="panel account-card"><h1 className="page-heading">이메일 주소 확인</h1><EmailLinkForm purpose="verify"/></section></main>;}
