import Link from 'next/link';
import type {ReactNode} from 'react';
import LogoutButton from '@/components/account/LogoutButton';
const menu=[['운영 현황','/admin'],['사용자','/admin/users'],['매거진','/admin/blog'],['이벤트 관리','/admin/events'],['이벤트 편집','/admin/event'],['문의','/admin/inquiries'],['답변 템플릿','/admin/inquiries/templates'],['키워드','/admin/keywords'],['보상','/admin/rewards'],['스캔 상태','/admin/scan-health'],['글쓰기','/admin/writing']];
export default function AdminShell({children,title,path}:{children:ReactNode;title:string;path:string}){
 return <div className="account-shell"><header className="account-header"><Link href="/admin" className="account-logo">NAEO<span>●</span> <small className="muted" style={{fontSize:13,letterSpacing:0}}>관리자</small></Link><div><Link href="/dashboard/settings">내 계정</Link><LogoutButton/></div></header><div className="account-layout"><aside className="account-sidebar"><nav aria-label="관리자 메뉴">{menu.map(([label,href])=><Link key={href} href={href} aria-current={href===path?'page':undefined}>{label}</Link>)}</nav></aside><main className="account-main admin-main"><p className="eyebrow">NAEO ADMIN</p><h1 className="page-heading">{title}</h1>{children}</main></div></div>;
}
