import type {CapturedNode,CapturedPageData} from '../../types/site';
import {mapTree,textOf,withChildren} from './tree';

/** 공개 화면에서도 캡처 당시 계정 대신 현재 로그인 상태를 표시한다. */
export function publicChrome(page:CapturedPageData,nickname:string|null):CapturedPageData{
 const transform=(nodes:CapturedNode[])=>mapTree(nodes,n=>n.tag==='nav'?[withChildren(n,mapTree(n.children,c=>{
  if(c.tag==='button'&&textOf(c)==='NAEO 블로거')return nickname?[{...c,tag:'a',attrs:{class:c.attrs.class,href:'/dashboard/settings'},children:[nickname]}]:[];
  if(c.tag==='a'&&c.attrs.href==='/dashboard'&&!nickname)return[{...c,attrs:{...c.attrs,href:'/login'},children:['시작하기']}];
  if(c.tag==='button'&&textOf(c)==='시작하기'&&nickname)return[{...c,tag:'a',attrs:{class:c.attrs.class,href:'/dashboard'},children:['대시보드']}];
  return undefined;
 }))]:undefined);
 return {...page,body:transform(page.body),...(page.states?{states:Object.fromEntries(Object.entries(page.states).map(([key,nodes])=>[key,transform(nodes)]))}:{})};
}
