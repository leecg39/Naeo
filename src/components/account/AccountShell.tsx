import Link from 'next/link';
import type { ReactNode } from 'react';
import LogoutButton from './LogoutButton';

const menu=[['대시보드','/dashboard'],['AI 인용 현황','/dashboard/ai-picks'],['키워드 추천','/dashboard/recommendations'],['경쟁 블로그','/dashboard/competitors'],['AI 글쓰기','/dashboard/write'],['네이버 메이트','/dashboard/mate'],['이벤트','/dashboard/events'],['소셜 제작','/dashboard/social'],['계정 설정','/dashboard/settings']];
export default function AccountShell({children,title,nickname,path,admin=false}:{children:ReactNode;title:string;nickname:string;path:string;admin?:boolean}) {
  return <div className="account-shell">
    <header className="account-header"><Link href="/" className="account-logo">NAEO<span>●</span></Link><div><span>{nickname}</span><LogoutButton/></div></header>
    <div className="account-layout"><aside className="account-sidebar"><nav aria-label="대시보드 메뉴">{menu.map(([label,href])=><Link key={href} href={href} aria-current={path===href?'page':undefined}>{label}</Link>)}{admin&&<Link href="/admin/users">사용자 관리 ↗</Link>}</nav><Link href="/">사이트로 돌아가기 ↗</Link></aside>
      <main className="account-main"><p className="eyebrow">MY NAEO</p><h1 className="page-heading">{title}</h1>{children}</main></div>
  </div>;
}
