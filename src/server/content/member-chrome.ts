import type {CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {getProfile} from '../profiles';
import {balance} from '../credits/ledger';
import {currentSubscription} from '../billing/subscriptions';
import {remainingScansToday} from '../jobs/queue';
import {hasClass,mapTree,textOf,withAttrs,withChildren} from './tree';

/** 캡처한 회원 내비게이션은 항상 현재 회원의 프로필·원장·구독을 사용한다. */
export function memberChrome(db:Database,userId:string,page:CapturedPageData,now=Date.now()):CapturedPageData{
 const profile=getProfile(db,userId),tokens=balance(db,userId),sub=currentSubscription(db,userId,now),scans=remainingScansToday(db,userId,now);
 const body=mapTree(page.body,n=>n.tag==='nav'?[withChildren(n,mapTree(n.children,c=>{
  if(hasClass('MuiAvatar-root')(c))return[withChildren(c,[Array.from(profile.nickname)[0]??'N'])];
  if(!c.children.every(v=>typeof v==='string'))return undefined;
  const text=textOf(c);
  if(text==='175토큰')return[withAttrs(withChildren(c,[`잔액 ${tokens}토큰`]),{'data-credit-balance':'true'})];
  if(text==='스캔 20회')return[withChildren(c,[`스캔 ${scans}회`])];
  if(text==='베이직 체험')return[withChildren(c,[sub?`${sub.planName}${sub.trial?' 체험':''}`:'무료 이용'])];
  if(text==='NAEO 블로거')return[withChildren(c,[profile.nickname])];
  return undefined;
 }))]:undefined);
 return{...page,body:mapTree(body,n=>n.attrs['aria-label']==='NAEO 블로거 설정'?[withAttrs(n,{'aria-label':`${profile.nickname} 설정`})]:undefined)};
}
