/**
 * 캡처된 /faq의 분류·질문·답변을 DB 시드로 추출한다(일반 텍스트, HTML 없음).
 * 실행: node --import tsx scripts/content/extract-faq.ts
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

export type SeedFaq={category:string;question:string;answer:string;position:number};
function findAll(nodes:CapturedNode[],pred:(n:El)=>boolean,out:El[]=[]):El[]{
 for(const n of nodes){if(!isEl(n))continue;if(pred(n))out.push(n);findAll(n.children,pred,out);}
 return out;
}

export function extractFaq():SeedFaq[]{
 const page=JSON.parse(readFileSync(path.join(ROOT,'src/data/pages',index['/faq']),'utf8')) as CapturedPageData;
 const sections=findAll(page.body,n=>n.tag==='section'&&n.children.some(c=>isEl(c)&&c.tag==='h2'));
 let position=0;
 return sections.flatMap(s=>{
  const category=textOf(s.children.filter(isEl).find(c=>c.tag==='h2')!).trim();
  return findAll(s.children,hasClass('MuiAccordion-root')).map(a=>({
   category,
   question:textOf(findAll(a.children,hasClass('mui-1sfflb6'))[0]),
   answer:textOf(findAll(a.children,hasClass('mui-1vau8ke'))[0]),
   position:position++
  }));
 });
}

if(process.argv[1]&&import.meta.url.endsWith(path.basename(process.argv[1]))){
 const items=extractFaq();
 const out=path.join(ROOT,'src/data/content/faq.seed.json');
 mkdirSync(path.dirname(out),{recursive:true});
 writeFileSync(out,JSON.stringify({items},null,1)+'\n');
 console.log(`faq items=${items.length} categories=${new Set(items.map(i=>i.category)).size} -> ${path.relative(ROOT,out)}`);
}
