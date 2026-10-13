import type { DemoProfile, Draft } from '@/types/site';
export const DEFAULT_PROFILE:DemoProfile={nickname:'NAEO 블로거',blogId:'naeo_blog',blogTitle:'일상을 기록하는 나의 블로그',credits:20,tokens:175,plan:'basic'};
export function readStore<T>(key:string,fallback:T):T{if(typeof window==='undefined')return fallback;try{return JSON.parse(localStorage.getItem('naeo-clone:'+key)||'null')??fallback}catch{return fallback}}
export function writeStore<T>(key:string,value:T){try{localStorage.setItem('naeo-clone:'+key,JSON.stringify(value));window.dispatchEvent(new CustomEvent('naeo-store',{detail:key}))}catch{}}
export function profile(){return readStore<DemoProfile>('profile',DEFAULT_PROFILE)}
export function drafts(){return readStore<Draft[]>('drafts',[])}
export function saveDraft(draft:Draft){writeStore('drafts',[draft,...drafts().filter(d=>d.id!==draft.id)])}
