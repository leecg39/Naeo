import Link from 'next/link';
export default function Forbidden(){return <main className="account-login"><div className="panel account-card"><p className="eyebrow">403</p><h1 className="page-heading">접근 권한이 없습니다</h1><p>이 페이지는 관리자만 이용할 수 있습니다.</p><Link className="button" href="/dashboard/settings">내 계정으로 돌아가기</Link></div></main>;}
