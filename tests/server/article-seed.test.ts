import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderMarkdown} from '../../src/server/content/markdown';
import {articleBody,extractAll} from '../../scripts/content/extract-articles';
import type {CapturedNode,CapturedPageData} from '../../src/types/site';

const seed=JSON.parse(readFileSync('src/data/content/articles.seed.json','utf8')) as ReturnType<typeof extractAll>;
const index=JSON.parse(readFileSync('src/data/page-index.json','utf8')) as Record<string,string>;

/** 이미지 로딩 상태(loaded)와 style 표기 차이, 속성 순서만 무시하고 노드 단위로 비교한다. */
function normalize(n:CapturedNode):CapturedNode{
 if(typeof n==='string')return n;
 const attrs=Object.fromEntries(Object.entries(n.attrs).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>{
  if(k==='class')return[k,v.split(/\s+/).filter(c=>c&&c!=='loaded').join(' ')];
  if(k==='style'&&/^color:\s*transparent;?$/.test(v))return[k,'color:transparent'];
  return[k,v];
 }));
 return{tag:n.tag,attrs,children:n.children.map(normalize)};
}

test('committed seed is up to date with the captured pages',()=>{
 assert.deepEqual(extractAll(),seed);
});

test('seed covers 4 categories and 20 articles with required metadata',()=>{
 assert.deepEqual(seed.categories.map(c=>c.slug),['marketing','guide','news','event']);
 assert.equal(seed.articles.length,20);
 for(const a of seed.articles){
  assert.ok(a.title&&a.summary&&a.coverImage&&a.tags.length&&a.readMinutes>0,a.slug);
  assert.ok(!Number.isNaN(Date.parse(a.publishedAt)),a.slug);
 }
 assert.deepEqual(seed.articles.filter(a=>a.featured).map(a=>a.slug).sort(),['golden-keywords','golden-keywords-guide']);
});

for(const a of seed.articles){
 const route=`/blog/${a.category}/${a.slug}`;
 test(`markdown re-renders identically to the captured body: ${route}`,()=>{
  const page=JSON.parse(readFileSync('src/data/pages/'+index[route],'utf8')) as CapturedPageData;
  const {nodes,warnings}=renderMarkdown(a.bodyMarkdown);
  assert.deepEqual(warnings,[]);
  assert.deepEqual(nodes.map(normalize),articleBody(page).children.map(normalize));
 });
}
