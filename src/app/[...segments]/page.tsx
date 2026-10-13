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
import { buildWritingPage } from '@/server/writing/writing-page';
import { memberChrome } from '@/server/content/member-chrome';
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
import Link from 'next/link';
import ConsentForm from '@/components/account/ConsentForm';
import CreativeViewer from '@/components/creative/CreativeViewer';
import ExportPanel from '@/components/creative/ExportPanel';
import { listExports } from '@/server/creative/exports';
import { getDraft } from '@/server/writing/drafts';
import { getProject } from '@/server/creative/projects';
import { ensureExtensionClient,problemRedirect,requestProblem,SCOPE_LABEL,validateAuthorizeRequest,type AuthorizeRequest } from '@/server/oauth/authz';
import type { CapturedPageData } from '@/types/site';
type Props={params:Promise<{segments:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
const first=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]:v;
// 블로그 글은 DB에서 읽으므로 요청마다 렌더링한다(관리자 수정·비공개 즉시 반영).
export const dynamic='force-dynamic';
/** DB가 맡는 경로(블로그·정책 문서·FAQ 등). undefined면 캡처 화면으로 넘긴다. */
const databasePage=cache(resolveDatabasePage);
/** 이벤트 상세는 DB의 이벤트 제목·요약을 메타데이터로 쓴다(원본 캡처 문구 대신). */
function eventMeta(path:string){const slug=path.match(/^\/(?:dashboard\/events|event)\/([a-z0-9][a-z0-9-]{1,59})$/)?.[1];const e=slug?getPublicEvent(contentDatabase(),slug):null;return e?{title:`${e.title} | NAEO`,description:e.summary}:undefined;}
export async function generateMetadata({params,searchParams}:Props):Promise<Metadata>{const path='/'+(await params).segments.join('/');if(['/social/aeo-carousel','/social/mate-ad','/youtube/aeo-intro'].includes(path.replace(/\/export$/,''))&&first((await searchParams).project))return{title:path.endsWith('/export')?'소셜 프로젝트 내보내기':'소셜 프로젝트 보기',robots:{index:false,follow:false}};const data=eventMeta(path)??(await databasePage(path))??await getCapturedPage(path);return{title:data?.title.replace(/(?: \| NAEO)+$/,'')||'NAEO',...(data?.description?{description:data.description}:{}),robots:{index:false,follow:false}}}
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
const flat=(sp:Record<string,string|string[]|undefined>)=>Object.fromEntries(Object.entries(sp).flatMap(([k,v])=>typeof v==='string'?[[k,v]]:[]));
/** /oauth/consent: 앱·돌아갈 주소가 틀리면 캡처 오류 상자, 다른 요청 오류는 앱으로, 정상이면 로그인 후 동의 화면. */
async function consentPage(sp:Record<string,string|string[]|undefined>){
 const query=flat(sp),db=contentDatabase();
 let req:AuthorizeRequest;
 try{req=validateAuthorizeRequest(db,query);}catch{const captured=await getCapturedPage('/oauth/consent');return captured?<PageExperience data={captured}/>:notFound();}
 const problem=requestProblem(req);
 if(problem)redirect(problemRedirect(req,problem));
 await pageUser(`/oauth/consent?${new URLSearchParams(query)}`);
 return <main className="account-login"><Link className="account-logo" href="/">NAEO<span>●</span></Link><div className="panel account-card"><p className="eyebrow">CONNECT APP</p><h1 className="page-heading">앱 연결 요청</h1>
  <ConsentForm params={query} appName={req.clientName} kind={req.kind} redirectHost={new URL(req.redirectUri).host||new URL(req.redirectUri).protocol} scopes={req.scopes.map(s=>({scope:s,label:SCOPE_LABEL[s]}))}/></div></main>;
}
/** /auth/extension: 허용된 확장 ID면 확장 클라이언트로 동의 화면에 보낸다. 아니면 캡처 오류 상자. */
function extensionRedirect(sp:Record<string,string|string[]|undefined>):string|null{
 const q=flat(sp),allowed=(process.env.NAEO_EXTENSION_IDS??'').split(',').map(v=>v.trim()).filter(Boolean);
 if(!q.extension_id||!allowed.includes(q.extension_id)||!q.code_challenge)return null;
 const client=ensureExtensionClient(contentDatabase(),q.extension_id);
 return `/oauth/consent?${new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:client.redirect_uris[0],state:q.state??'',code_challenge:q.code_challenge,code_challenge_method:q.code_challenge_method??'S256',scope:q.scope??'naeo:read naeo:write'})}`;
}
/** /preview?id=: 내 초안 미리보기(서버 저장본, 허용 목록 HTML을 샌드박스 iframe으로). id가 없으면 글쓰기로. */
async function draftPreview(sp:Record<string,string|string[]|undefined>){
 const id=first(sp.id);
 if(!id||!/^[a-f0-9-]{36}$/.test(id))redirect('/dashboard/write');
 const user=await pageUser(`/preview?id=${id}`);
 let draft:{title:string};
 try{draft=getDraft(database(),user.id,id) as {title:string};}catch{notFound();}
 return <main className="account-login" style={{maxWidth:980}}><Link className="account-logo" href="/">NAEO<span>●</span></Link><div className="panel account-card"><p className="eyebrow">PREVIEW</p><h1 className="page-heading">{draft.title}</h1>
  <iframe title="초안 미리보기" src={`/api/drafts/${id}/export?format=html`} style={{width:'100%',minHeight:'70vh',border:'1px solid #e5e5e5',borderRadius:12,background:'#fff'}}/>
  <div className="account-actions"><a className="button" href={`/dashboard/write?draft=${id}`}>이어서 편집</a><a className="button secondary" href={`/api/drafts/${id}/export?format=html&download=1`}>HTML 내려받기</a></div></div></main>;
}
export default async function Page({params,searchParams}:Props){
 const path='/'+(await params).segments.join('/');
 if(path==='/dashboard'||path.startsWith('/dashboard/')){
  const user=await pageUser(path);
  const memberView=(data:CapturedPageData)=><PageExperience data={memberChrome(database(),user.id,data)}/>;
  // 대시보드는 로그인 회원 본인의 블로그·진단 결과로 채운다(원본 계정 데이터 미노출).
  if(path==='/dashboard')return memberView(await buildDashboardPage(database(),user.id));
  if(path==='/dashboard/mate')return memberView(await buildMateDashboardPage(database(),user.id));
  if(path==='/dashboard/ai-picks')return memberView(await buildAiPicksPage());
  if(path==='/dashboard/competitors')return memberView(await buildCompetitorsPage(database(),user.id));
  if(path==='/dashboard/events')return memberView(await buildDashboardEventsPage(contentDatabase(),user.id));
  const dashEvent=path.match(/^\/dashboard\/events\/([a-z0-9][a-z0-9-]{1,59})$/)?.[1];
  if(path.startsWith('/dashboard/events/')){const detail=dashEvent?await buildEventDetailPage(contentDatabase(),dashEvent,{dashboard:true}):null;if(!detail)notFound();return <>{memberView(detail)}<EventEntryPanel/></>;}
  if(path==='/dashboard/write')return <><PageExperience data={await buildWritingPage(database(),user.id)}/><DraftsWorkspace/></>;
  if(path==='/dashboard/recommendations'){const sp=await searchParams;return memberView(await buildRecommendationsPage(database(),user.id,{q:first(sp.q),page:first(sp.page)}));}
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
 const exporting=path.endsWith('/export'),viewKind={'/social/aeo-carousel':'carousel','/social/mate-ad':'ad','/youtube/aeo-intro':'video'}[exporting?path.slice(0,-7):path];
 if(viewKind){const sp=await searchParams,id=first(sp.project);if(id){const user=await pageUser(`${path}?project=${encodeURIComponent(id)}`);let project;try{project=getProject(database(),user.id,id);}catch{notFound();}if(project.kind!==viewKind)notFound();return exporting?<ExportPanel project={project} initial={listExports(database(),user.id,project.id)}/>:<CreativeViewer project={project}/>;}}
 if(path==='/preview')return draftPreview(await searchParams);
 // 개발용 미리보기는 관리자만(다른 회원·비로그인에게는 존재하지 않는 페이지).
 if(path.startsWith('/dev/')){const viewer=await currentUser();if(viewer?.role!=='admin')notFound();}
 if(path==='/oauth/consent')return consentPage(await searchParams);
 if(path==='/auth/extension'){const to=extensionRedirect(await searchParams);if(to)redirect(to);}
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
