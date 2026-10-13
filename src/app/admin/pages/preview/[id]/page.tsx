import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {adminPageUser} from '@/server/current-user';
import {contentDatabase} from '@/server/content/public-pages';
import {getAdminDocument} from '@/server/content/admin-documents';
import {buildDocumentPage} from '@/server/content/document-pages';
import {AppError} from '@/server/errors';
import PageExperience from '@/components/PageExperience';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'문서 미리보기',robots:{index:false,follow:false}};
type Props={params:Promise<{id:string}>};

/** 관리자 전용 미리보기: 초안 문서도 공개 화면과 같은 틀로 렌더링한다. */
export default async function DocumentPreview({params}:Props){
 const {id}=await params;
 const user=await adminPageUser('/admin/pages');
 if(!/^[a-f0-9-]{36}$/.test(id))notFound();
 let doc;
 try{doc=getAdminDocument(contentDatabase(),user.id,id);}
 catch(e){if(e instanceof AppError&&e.status===404)notFound();throw e;}
 const page=await buildDocumentPage(doc);
 return <>
  <div className="preview-banner" role="status">미리보기 · {doc.status==='published'?'공개':'초안'} · 버전 {doc.version}<a href="/admin/pages">관리로 돌아가기</a></div>
  <PageExperience data={page}/>
 </>;
}
