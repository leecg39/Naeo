/**
 * 캡처된 /blog 기사 20개를 DB 시드(마크다운+메타데이터)로 추출한다.
 * 실행: node --import tsx scripts/content/extract-articles.ts
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import type {CapturedNode,CapturedPageData} from '../../src/types/site';
import {toMarkdown} from './to-markdown';

type El=Exclude<CapturedNode,string>;
const isEl=(n:CapturedNode):n is El=>typeof n!=='string';
const ROOT=process.cwd();
const index=JSON.parse(readFileSync(path.join(ROOT,'src/data/page-index.json'),'utf8')) as Record<string,string>;
const load=(route:string)=>JSON.parse(readFileSync(path.join(ROOT,'src/data/pages',index[route]),'utf8')) as CapturedPageData;

export function find(nodes:CapturedNode[],pred:(n:El)=>boolean):El|undefined{
 for(const n of nodes){if(!isEl(n))continue;if(pred(n))return n;const r=find(n.children,pred);if(r)return r;}
}
export function findAll(nodes:CapturedNode[],pred:(n:El)=>boolean,out:El[]=[]):El[]{
 for(const n of nodes){if(!isEl(n))continue;if(pred(n))out.push(n);findAll(n.children,pred,out);}
 return out;
}
export const hasClass=(c:string)=>(n:El)=>(n.attrs.class??'').split(/\s+/).includes(c);
export const textOf=(n:CapturedNode):string=>isEl(n)?n.children.map(textOf).join(''):n;

export type SeedCategory={slug:string;name:string;sortOrder:number};
export type SeedArticle={slug:string;category:string;title:string;summary:string;showSummary:boolean;bodyMarkdown:string;tags:string[];coverImage:string;featured:boolean;publishedAt:string;readMinutes:number;position:number};

export function articleBody(page:CapturedPageData):El{
 const body=find(page.body,hasClass('mui-49c794'));
 if(!body)throw new Error('article body not found: '+page.path);
 return body;
}

function extractArticle(route:string,cards:Map<string,string>,summaries:Map<string,string>,featured:Set<string>,positions:Map<string,number>):SeedArticle{
 const page=load(route);
 const [,,category,slug]=route.split('/');
 const header=find(page.body,hasClass('mui-1yjvs5a'))!;
 const time=find(header.children,n=>n.tag==='time')!;
 const read=textOf(find(header.children,n=>n.tag==='span'&&/min read/.test(textOf(n)))??time).match(/(\d+)\s*min/);
 if(!read)throw new Error('read time not found: '+route);
 const tags=findAll(find(page.body,hasClass('mui-kdcaw'))?.children??[],hasClass('mui-oruufx')).map(textOf);
 const summary=find(header.children,n=>n.tag==='p');
 return{
  slug,category,title:textOf(find(header.children,n=>n.tag==='h1')!).trim(),
  // 이벤트 기사 원본 머리말에는 요약이 없다. 요약은 /blog 목록 카드 문구로 보존한다.
  summary:summary?textOf(summary).trim():(summaries.get(route)??''),showSummary:Boolean(summary),
  bodyMarkdown:toMarkdown(articleBody(page)),tags,coverImage:cards.get(route)??'',featured:featured.has(route),
  publishedAt:time.attrs.datetime,readMinutes:read?Number(read[1]):1,position:positions.get(route)??0
 };
}

export function extractAll():{categories:SeedCategory[];articles:SeedArticle[]}{
 const blog=load('/blog');
 const cards=new Map<string,string>(),summaries=new Map<string,string>(),featured=new Set<string>();
 for(const a of findAll(blog.body,n=>n.tag==='a'&&/^\/blog\/[^/]+\/[^/]+$/.test(n.attrs.href??''))){
  const img=find(a.children,n=>n.tag==='img');
  if(img&&!cards.has(a.attrs.href))cards.set(a.attrs.href,img.attrs.src);
  const caption=find(a.children,n=>(n.tag==='span'&&hasClass('MuiTypography-caption')(n)&&!/min read/.test(textOf(n)))||(n.tag==='p'&&hasClass('MuiTypography-body2')(n)));
  if(caption&&!summaries.has(a.attrs.href))summaries.set(a.attrs.href,textOf(caption).trim());
 }
 for(const section of findAll(blog.body,n=>n.tag==='section')){
  const label=find(section.children,n=>n.tag==='span');
  if(label&&textOf(label).trim()==='추천 가이드')for(const a of findAll(section.children,n=>n.tag==='a'))featured.add(a.attrs.href);
 }
 const sidebar=find(blog.body,n=>n.tag==='aside'&&n.attrs['aria-label']==='블로그 사이드바')!;
 const groups=findAll(sidebar.children,hasClass('mui-i3pbo'));
 const positions=new Map<string,number>();const names=new Map<string,string>();
 groups.forEach(g=>findAll(g.children,n=>n.tag==='a').forEach((a,i)=>{positions.set(a.attrs.href,i);names.set(a.attrs.href.split('/')[2],textOf(find(g.children,n=>n.tag==='span')!).trim());}));
 const routes=Object.keys(index).filter(r=>/^\/blog\/[^/]+\/[^/]+$/.test(r));
 const articles=routes.map(r=>extractArticle(r,cards,summaries,featured,positions));
 const order=[...new Set(groups.map(g=>findAll(g.children,n=>n.tag==='a')[0].attrs.href.split('/')[2]))];
 const categories=order.map((slug,i)=>({slug,name:names.get(slug)!,sortOrder:i}));
 return{categories,articles};
}

if(process.argv[1]&&import.meta.url.endsWith(path.basename(process.argv[1]))){
 const seed=extractAll();
 const out=path.join(ROOT,'src/data/content/articles.seed.json');
 mkdirSync(path.dirname(out),{recursive:true});
 writeFileSync(out,JSON.stringify(seed,null,1)+'\n');
 console.log(`categories=${seed.categories.length} articles=${seed.articles.length} -> ${path.relative(ROOT,out)}`);
}
