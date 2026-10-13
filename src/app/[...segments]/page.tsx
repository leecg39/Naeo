import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { getCapturedPage } from '@/lib/pages';
import PageExperience from '@/components/PageExperience';
import { pageUser,adminPageUser,currentUser } from '@/server/current-user';
import { cache } from 'react';
import { contentDatabase,resolveDatabasePage } from '@/server/content/public-pages';
import { activeAnnouncement } from '@/server/content/announcements';
import { buildDashboardPage } from '@/server/analysis/dashboard-page';
import { buildMateDashboardPage } from '@/server/mate/mate-dashboard';
import { buildAiPicksPage } from '@/server/analysis/ai-picks-page';
import { buildRecommendationsPage } from '@/server/keywords/recommendations-page';
import { buildCompetitorsPage } from '@/server/competitors/competitors-page';
import DraftsWorkspace from '@/components/writing/DraftsWorkspace';
import { ImagesLibrary,SharedImages } from '@/components/writing/ImagePages';
import { buildRankingPage } from '@/server/ranking/ranking-page';
import { ensureConfirmed } from '@/server/ranking/ranking-api';
import { database } from '@/server/database';
import AnnouncementBar from '@/components/content/AnnouncementBar';
import type { CapturedPageData } from '@/types/site';
type Props={params:Promise<{segments:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
const first=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]:v;
// 블로그 글은 DB에서 읽으므로 요청마다 렌더링한다(관리자 수정·비공개 즉시 반영).
export const dynamic='force-dynamic';
/** DB가 맡는 경로(블로그·정책 문서·FAQ 등). undefined면 캡처 화면으로 넘긴다. */
const databasePage=cache(resolveDatabasePage);
export async function generateMetadata({params}:Props):Promise<Metadata>{const path='/'+(await params).segments.join('/');const data=(await databasePage(path))??await getCapturedPage(path);return{title:data?.title.replace(/(?: \| NAEO)+$/,'')||'NAEO',...(data?.description?{description:data.description}:{}),robots:{index:false,follow:false}}}
/** 공개 화면에는 '전체' 대상 공지를 함께 띄운다(대시보드·관리자 등은 activeAnnouncement가 제외). */
function withNotice(path:string,data:CapturedPageData){const notice=activeAnnouncement(contentDatabase(),path);return <><PageExperience data={data}/>{notice&&<AnnouncementBar announcement={notice}/>}</>;}
export default async function Page({params,searchParams}:Props){
 const path='/'+(await params).segments.join('/');
 if(path==='/dashboard'||path.startsWith('/dashboard/')){
  const user=await pageUser(path);
  // 대시보드는 로그인 회원 본인의 블로그·진단 결과로 채운다(원본 계정 데이터 미노출).
  if(path==='/dashboard')return <PageExperience data={await buildDashboardPage(database(),user.id)}/>;
  if(path==='/dashboard/mate')return <PageExperience data={await buildMateDashboardPage(database(),user.id)}/>;
  if(path==='/dashboard/ai-picks')return <PageExperience data={await buildAiPicksPage()}/>;
  if(path==='/dashboard/competitors')return <PageExperience data={await buildCompetitorsPage(database(),user.id)}/>;
  if(path==='/dashboard/write'){const captured=await getCapturedPage(path);if(captured)return <><PageExperience data={captured}/><DraftsWorkspace/></>;}
  if(path==='/dashboard/recommendations'){const sp=await searchParams;return <PageExperience data={await buildRecommendationsPage(database(),user.id,{q:first(sp.q),page:first(sp.page)})}/>;}
 }
 if(path.startsWith('/updates/'))permanentRedirect('/updates?focus='+encodeURIComponent(path.slice(9)));
 if(path==='/admin'||path.startsWith('/admin/')){await adminPageUser(path);notFound();}
 if(path.startsWith('/social/banner-preview'))redirect('/');
 if(path==='/auth/google')redirect('/login?provider=google&demo=1');
 if(path==='/ranking'){
  const sp=await searchParams,viewer=await currentUser(),db=database();
  ensureConfirmed(db,new URLSearchParams({period:first(sp.period)??'',offset:first(sp.offset)??'0'}));
  return withNotice(path,await buildRankingPage(db,{period:first(sp.period),page:first(sp.page)},viewer?.id??null));
 }
 const fromDb=await databasePage(path);
 if(fromDb===null)notFound();
 if(fromDb)return withNotice(path,fromDb);
 const data=await getCapturedPage(path);
 if(data&&path==='/images')return <>{withNotice(path,data)}<ImagesLibrary/></>;
 if(data)return withNotice(path,data);
 if(path.startsWith('/dashboard/events/')){const event=await getCapturedPage('/event/'+path.split('/').at(-1));if(event)return <PageExperience data={{...event,path}}/>;redirect('/dashboard/events')}
 const shareToken=path.match(/^\/p\/([A-Za-z0-9_-]{22})\/images$/)?.[1];
 if(shareToken){const images=await getCapturedPage('/images');if(images)return <><PageExperience data={{...images,path}}/><SharedImages token={shareToken}/></>}
 notFound();
}
