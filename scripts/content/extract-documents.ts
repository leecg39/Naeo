/**
 * 캡처된 정책 문서(/terms /privacy /privacy/extension /refund)를 DB 시드로 추출한다.
 * 본문은 "## 소제목" 줄로 절을 나누는 일반 텍스트로 저장한다(HTML 없음).
 * 실행: node --import tsx scripts/content/extract-documents.ts
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import type {CapturedNode,CapturedPageData} from '../../src/types/site';

type El=Exclude<CapturedNode,string>;
const isEl=(n:CapturedNode):n is El=>typeof n!=='string';
const hasClass=(c:string)=>(n:El)=>(n.attrs.class??'').split(/\s+/).includes(c);
const textOf=(n:CapturedNode):string=>isEl(n)?n.children.map(textOf).join(''):n;
const ROOT=process.cwd();
const index=JSON.parse(readFileSync(path.join(ROOT,'src/data/page-index.json'),'utf8')) as Record<string,string>;
const load=(route:string)=>JSON.parse(readFileSync(path.join(ROOT,'src/data/pages',index[route]),'utf8')) as CapturedPageData;

export const DOCUMENT_PATHS=['/terms','/privacy','/privacy/extension','/refund'] as const;
export type SeedDocument={path:string;title:string;effectiveLabel:string;body:string;closingNote:string;position:number};

function find(nodes:CapturedNode[],pred:(n:El)=>boolean):El|undefined{
 for(const n of nodes){if(!isEl(n))continue;if(pred(n))return n;const r=find(n.children,pred);if(r)return r;}
 return undefined;
}

export function extractDocument(route:string,position:number):SeedDocument{
 const page=load(route);
 const main=find(page.body,hasClass('mui-1thvpft'));
 if(!main)throw new Error('document container missing: '+route);
 const parts=main.children.filter(isEl);
 const title=textOf(parts.find(n=>n.tag==='h4')!).trim();
 const effectiveLabel=textOf(parts.find(hasClass('mui-c0skwh'))!).trim();
 const sections=parts.filter(hasClass('mui-1yjvs5a')).map(s=>{
  const [h,p]=s.children.filter(isEl);
  return`## ${textOf(h).trim()}\n${textOf(p)}`;
 });
 const closing=parts.find(hasClass('mui-hniutj'));
 return{path:route,title,effectiveLabel,body:sections.join('\n\n'),closingNote:closing?textOf(closing):'',position};
}

export const extractDocuments=():SeedDocument[]=>DOCUMENT_PATHS.map((p,i)=>extractDocument(p,i));

if(process.argv[1]&&import.meta.url.endsWith(path.basename(process.argv[1]))){
 const documents=extractDocuments();
 const out=path.join(ROOT,'src/data/content/documents.seed.json');
 mkdirSync(path.dirname(out),{recursive:true});
 writeFileSync(out,JSON.stringify({documents},null,1)+'\n');
 console.log(`documents=${documents.length} -> ${path.relative(ROOT,out)}`);
}
