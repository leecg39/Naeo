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
import EventEntryPanel from '@/components/events/EventEntryPanel';
import { buildDashboardEventsPage,buildEventDetailPage,buildEventListPage } from '@/server/events/event-pages';
import { getPublicEvent } from '@/server/events/events';
import { buildPricingPage } from '@/server/billing/pricing-page';
import { buildPaymentCompletePage } from '@/server/billing/payment-complete-page';
import { abandonCheckout,confirmPayment,paymentForOwner,type Payment } from '@/server/billing/payments';
import { currentSubscription } from '@/server/billing/subscriptions';
import { tossProvider } from '@/server/billing/provider';
import { AppError } from '@/server/errors';
import type { CapturedPageData } from '@/types/site';
type Props={params:Promise<{segments:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
const first=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]:v;
// 블로그 글은 DB에서 읽으므로 요청마다 렌더링한다(관리자 수정·비공개 즉시 반영).
export const dynamic='force-dynamic';
/** DB가 맡는 경로(블로그·정책 문서·FAQ 등). undefined면 캡처 화면으로 넘긴다. */
const databasePage=cache(resolveDatabasePage);
/** 이벤트 상세는 DB의 이벤트 제목·요약을 메타데이터로 쓴다(원본 캡처 문구 대신). */
function eventMeta(path:string){const slug=path.match(/^\/(?:dashboard\/events|event)\/([a-z0-9][a-z0-9-]{1,59})$/)?.[1];const e=slug?getPublicEvent(contentDatabase(),slug):null;return e?{title:`${e.title} | NAEO`,description:e.summary}:undefined;}
export async function generateMetadata({params}:Props):Promise<Metadata>{const path='/'+(await params).segments.join('/');const data=eventMeta(path)??(await databasePage(path))??await getCapturedPage(path);return{title:data?.title.replace(/(?: \| NAEO)+$/,'')||'NAEO',...(data?.description?{description:data.description}:{}),robots:{index:false,follow:false}}}
/** 공개 화면에는 '전체' 대상 공지를 함께 띄운다(대시보드·관리자 등은 activeAnnouncement가 제외). */
function withNotice(path:string,data:CapturedPageData){const notice=activeAnnouncement(contentDatabase(),path);return <><PageExperience data={data}/>{notice&&<AnnouncementBar announcement={notice}/>}</>;}
/** 결제창에서 돌아온 결과: 성공이면 서버에서 승인(멱등), 실패면 주문 실패 처리. 화면은 저장된 주문 상태로 그린다. */
async function paymentCompletePage(sp:Record<string,string|string[]|undefined>){
 const query=new URLSearchParams(Object.entries(sp).flatMap(([k,v])=>typeof v==='string'?[[k,v]]:[]));
 const user=await pageUser(`/payment/complete${query.size?`?${query}`:''}`),db=contentDatabase();
 const orderId=first(sp.orderId),paymentKey=first(sp.paymentKey);
 let error:string|null=null,payment:Payment|null=null;
 if(orderId&&paymentKey){try{await confirmPayment(db,tossProvider(),user.id,{paymentKey,orderId,amount:first(sp.amount)});}catch(e){error=e instanceof AppError?e.message:'결제 정보를 확인하지 못했습니다.';}}
 else if(orderId&&first(sp.code)){abandonCheckout(db,user.id,orderId,{code:first(sp.code),message:first(sp.message)});error=(first(sp.message)??'결제가 취소되었습니다.').slice(0,300);}
 if(orderId){try{payment=paymentForOwner(db,user.id,orderId);}catch{payment=null;}}
 return buildPaymentCompletePage({payment,subscription:currentSubscription(db,user.id),error});
}
export default async function Page({params,searchParams}:Props){
 const path='/'+(await params).segments.join('/');
 if(path==='/dashboard'||path.startsWith('/dashboard/')){
  const user=await pageUser(path);
  // 대시보드는 로그인 회원 본인의 블로그·진단 결과로 채운다(원본 계정 데이터 미노출).
  if(path==='/dashboard')return <PageExperience data={await buildDashboardPage(database(),user.id)}/>;
  if(path==='/dashboard/mate')return <PageExperience data={await buildMateDashboardPage(database(),user.id)}/>;
  if(path==='/dashboard/ai-picks')return <PageExperience data={await buildAiPicksPage()}/>;
  if(path==='/dashboard/competitors')return <PageExperience data={await buildCompetitorsPage(database(),user.id)}/>;
  if(path==='/dashboard/events')return <PageExperience data={await buildDashboardEventsPage(contentDatabase(),user.id)}/>;
  const dashEvent=path.match(/^\/dashboard\/events\/([a-z0-9][a-z0-9-]{1,59})$/)?.[1];
  if(path.startsWith('/dashboard/events/')){const detail=dashEvent?await buildEventDetailPage(contentDatabase(),dashEvent,{dashboard:true}):null;if(!detail)notFound();return <><PageExperience data={detail}/><EventEntryPanel/></>;}
  if(path==='/dashboard/write'){const captured=await getCapturedPage(path);if(captured)return <><PageExperience data={captured}/><DraftsWorkspace/></>;}
  if(path==='/dashboard/recommendations'){const sp=await searchParams;return <PageExperience data={await buildRecommendationsPage(database(),user.id,{q:first(sp.q),page:first(sp.page)})}/>;}
 }
 if(path.startsWith('/updates/'))permanentRedirect('/updates?focus='+encodeURIComponent(path.slice(9)));
 if(path==='/admin'||path.startsWith('/admin/')){await adminPageUser(path);notFound();}
 if(path.startsWith('/social/banner-preview'))redirect('/');
 if(path==='/auth/google'||path==='/auth/naver'){const sp=await searchParams,next=first(sp.next);redirect(`/api/auth/oauth/${path.slice(6)}/start${next?`?next=${encodeURIComponent(next)}`:''}`);}
 if(path==='/ranking'){
  const sp=await searchParams,viewer=await currentUser(),db=database();
  ensureConfirmed(db,new URLSearchParams({period:first(sp.period)??'',offset:first(sp.offset)??'0'}));
  return withNotice(path,await buildRankingPage(db,{period:first(sp.period),page:first(sp.page)},viewer?.id??null));
 }
 if(path==='/pricing'){const viewer=await currentUser();return withNotice(path,await buildPricingPage(contentDatabase(),viewer?.id??null,tossProvider()!==null));}
 if(path==='/payment/complete')return <PageExperience data={await paymentCompletePage(await searchParams)}/>;
 if(path==='/event')return withNotice(path,await buildEventListPage(contentDatabase()));
 if(path.startsWith('/event/')){
  const slug=path.match(/^\/event\/([a-z0-9][a-z0-9-]{1,59})$/)?.[1];
  const detail=slug?await buildEventDetailPage(contentDatabase(),slug,{dashboard:false}):null;
  if(!detail)notFound();
  return <>{withNotice(path,detail)}<EventEntryPanel/></>;
 }
 const fromDb=await databasePage(path);
 if(fromDb===null)notFound();
 if(fromDb)return withNotice(path,fromDb);
 const data=await getCapturedPage(path);
 if(data&&path==='/images')return <>{withNotice(path,data)}<ImagesLibrary/></>;
 if(data)return withNotice(path,data);
 const shareToken=path.match(/^\/p\/([A-Za-z0-9_-]{22})\/images$/)?.[1];
 if(shareToken){const images=await getCapturedPage('/images');if(images)return <><PageExperience data={{...images,path}}/><SharedImages token={shareToken}/></>}
 notFound();
}
