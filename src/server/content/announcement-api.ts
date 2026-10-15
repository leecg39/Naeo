import {z} from 'zod';
import type {Database} from '../database';
import {requireTerms,requireUser} from '../auth';
import {cookieToken,json} from '../http';
import {publishedAnnouncements} from './announcements';

const targetInput=z.enum(['landing','dashboard']);
/** REA HTTP-05의 외부 필드명. 작성자·내부 상태·감사 데이터는 공개하지 않는다. */
export function announcementApi(db:Database,request:Request):Response|null{
 const url=new URL(request.url);
 if(url.pathname!=='/api/announcements')return null;
 if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'GET 요청을 사용해주세요.'}},405,{Allow:'GET'});
 const target=targetInput.parse(url.searchParams.get('target')??'landing');
 // dashboard 인증 경계는 원본 미확인: 클론에서는 회원 대상 공지를 인증 뒤 제공한다.
 if(target==='dashboard')requireTerms(requireUser(db,cookieToken(request)));
 const iso=(value:number|null)=>value===null?null:new Date(value).toISOString();
 return json({announcements:publishedAnnouncements(db,target).map(a=>({
  id:a.id,title:a.title,content:a.body,type:a.type,target:a.target==='all'?'landing':a.target,
  link_url:a.linkUrl||null,metadata:a.metadata,start_date:iso(a.startsAt),end_date:iso(a.endsAt),
 }))});
}
