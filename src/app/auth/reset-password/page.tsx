import {EmailLinkForm} from '@/components/account/AccountMailForms';
export const metadata={title:'새 비밀번호 설정',referrer:'no-referrer' as const,robots:{index:false,follow:false}};
export default function ResetPasswordPage(){return <main className="account-login"><section className="panel account-card"><h1 className="page-heading">새 비밀번호 설정</h1><EmailLinkForm purpose="reset"/></section></main>;}
