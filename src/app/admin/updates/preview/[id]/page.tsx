import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {adminPageUser} from '@/server/current-user';
import {contentDatabase} from '@/server/content/public-pages';
import {getAdminUpdate} from '@/server/content/admin-updates';
import {listPublishedUpdates} from '@/server/content/updates';
import {buildUpdatesPage} from '@/server/content/updates-pages';
import {AppError} from '@/server/errors';
import PageExperience from '@/components/PageExperience';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'업데이트 미리보기',robots:{index:false,follow:false}};
type Props={params:Promise<{id:string}>};

/** 관리자 전용: 초안 업데이트를 공개 목록 사이에 넣어 실제 화면 그대로 보여주고 해당 항목을 펼친다. */
export default async function UpdatePreview({params}:Props){
 const {id}=await params;
 const user=await adminPageUser('/admin/updates');
 if(!/^[a-f0-9-]{36}$/.test(id))notFound();
 const db=contentDatabase();
 let item;
 try{item=getAdminUpdate(db,user.id,id);}
 catch(e){if(e instanceof AppError&&e.status===404)notFound();throw e;}
 const list=[...listPublishedUpdates(db).filter(u=>u.id!==item.id),item].sort((a,b)=>b.publishedOn.localeCompare(a.publishedOn)||a.position-b.position);
 const page=await buildUpdatesPage(list);
 return <>
  <div className="preview-banner" role="status">미리보기 · {item.status==='published'?'공개':'초안'} · 버전 {item.version}<a href="/admin/updates">관리로 돌아가기</a></div>
  <PageExperience data={{...page,path:'/updates'}}/>
 </>;
}
