/**
 * 캡처된 /updates의 업데이트 23건을 DB 시드(마크다운 본문+메타데이터)로 추출한다.
 * 실행: node --import tsx scripts/content/extract-updates.ts
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import type {CapturedNode,CapturedPageData} from '../../src/types/site';
import {toMarkdown} from './to-markdown';

type El=Exclude<CapturedNode,string>;
const isEl=(n:CapturedNode):n is El=>typeof n!=='string';
const hasClass=(c:string)=>(n:El)=>(n.attrs.class??'').split(/\s+/).includes(c);
const textOf=(n:CapturedNode):string=>isEl(n)?n.children.map(textOf).join(''):n;
const ROOT=process.cwd();
const index=JSON.parse(readFileSync(path.join(ROOT,'src/data/page-index.json'),'utf8')) as Record<string,string>;

/** 화면의 분류 칩 이름 → 저장 값. '버그 수정'은 필터에만 있고 캡처 항목에는 없다. */
export const UPDATE_TYPE_LABELS={feature:'새 기능',improvement:'개선',fix:'버그 수정',design:'디자인'} as const;
export type UpdateType=keyof typeof UPDATE_TYPE_LABELS;
export type SeedUpdate={slug:string;versionLabel:string;types:UpdateType[];title:string;summary:string;bodyMarkdown:string;publishedOn:string};

function findAll(nodes:CapturedNode[],pred:(n:El)=>boolean,out:El[]=[]):El[]{
 for(const n of nodes){if(!isEl(n))continue;if(pred(n))out.push(n);findAll(n.children,pred,out);}
 return out;
}
const one=(nodes:CapturedNode[],pred:(n:El)=>boolean,what:string)=>{const r=findAll(nodes,pred)[0];if(!r)throw new Error('missing '+what);return r;};
const typeOf=(label:string)=>{const e=Object.entries(UPDATE_TYPE_LABELS).find(([,l])=>l===label);if(!e)throw new Error('unknown update type: '+label);return e[0] as UpdateType;};

export function updateBody(article:El):El{return one(article.children,hasClass('mdx-prose'),'prose');}

export function extractUpdates():SeedUpdate[]{
 const page=JSON.parse(readFileSync(path.join(ROOT,'src/data/pages',index['/updates']),'utf8')) as CapturedPageData;
 return findAll(page.body,n=>n.tag==='article'&&!!n.attrs.id).map(a=>{
  const chips=findAll(a.children,hasClass('MuiChip-root')).map(c=>textOf(c).trim());
  return{
   slug:a.attrs.id,
   versionLabel:chips[0],
   types:chips.slice(1).map(typeOf),
   title:textOf(one(a.children,n=>n.tag==='h3','title')).trim(),
   summary:textOf(one(a.children,hasClass('mui-f7fcvj'),'summary')).trim(),
   bodyMarkdown:toMarkdown(updateBody(a)),
   publishedOn:one(a.children,n=>n.tag==='time','time').attrs.datetime.slice(0,10)
  };
 });
}

if(process.argv[1]&&import.meta.url.endsWith(path.basename(process.argv[1]))){
 const updates=extractUpdates();
 const out=path.join(ROOT,'src/data/content/updates.seed.json');
 mkdirSync(path.dirname(out),{recursive:true});
 writeFileSync(out,JSON.stringify({updates},null,1)+'\n');
 console.log(`updates=${updates.length} -> ${path.relative(ROOT,out)}`);
}
