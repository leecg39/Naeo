import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {adminPageUser} from '@/server/current-user';
import {contentDatabase} from '@/server/content/public-pages';
import {getAdminArticle} from '@/server/content/admin-articles';
import {buildArticlePage} from '@/server/content/blog-pages';
import {appOrigin} from '@/server/http';
import {AppError} from '@/server/errors';
import PageExperience from '@/components/PageExperience';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'글 미리보기',robots:{index:false,follow:false}};
type Props={params:Promise<{id:string}>};
const STATE={draft:'초안',published:'공개',archived:'비공개'} as const;
const stateLabel=(a:{status:keyof typeof STATE;publishedAt:number|null})=>a.status==='published'&&a.publishedAt!==null&&a.publishedAt>Date.now()?'예약':STATE[a.status];

/** 관리자 전용 미리보기: 초안·예약·비공개 글도 공개 화면과 같은 틀로 렌더링한다. */
export default async function ArticlePreview({params}:Props){
 const {id}=await params;
 const user=await adminPageUser('/admin/blog');
 if(!/^[a-f0-9-]{36}$/.test(id))notFound();
 let article;
 try{article=getAdminArticle(contentDatabase(),user.id,id);}
 catch(e){if(e instanceof AppError&&e.status===404)notFound();throw e;}
 const page=await buildArticlePage(contentDatabase(),article,{origin:appOrigin()});
 return <>
  <div className="preview-banner" role="status">미리보기 · {stateLabel(article)} · 버전 {article.version}<a href="/admin/blog">관리로 돌아가기</a></div>
  <PageExperience data={{...page,path:article.url}}/>
 </>;
}
