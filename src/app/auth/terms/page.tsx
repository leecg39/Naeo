import Link from 'next/link';
import {redirect} from 'next/navigation';
import {currentUser} from '@/server/current-user';
import {safeNext} from '@/lib/safe-next';
import TermsForm from '@/components/account/TermsForm';
import LogoutButton from '@/components/account/LogoutButton';
export const dynamic='force-dynamic';
export default async function TermsPage({searchParams}:{searchParams:Promise<{next?:string}>}){
 const user=await currentUser(),{next}=await searchParams;
 if(!user)redirect('/login');if(user.termsAcceptedAt)redirect(safeNext(next));
 return <main className="account-login"><Link className="account-logo" href="/">NAEO</Link><div className="panel account-card"><h1 className="page-heading">시작하기 전에</h1><TermsForm next={next} user={user}/></div><LogoutButton/></main>;
}
