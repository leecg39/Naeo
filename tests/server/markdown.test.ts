import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown} from '../../src/server/content/markdown';
import type {CapturedNode} from '../../src/types/site';

type El=Exclude<CapturedNode,string>;
const els=(nodes:CapturedNode[])=>nodes.filter((n):n is El=>typeof n!=='string');
const text=(n:CapturedNode):string=>typeof n==='string'?n:n.children.map(text).join('');

test('inline formatting maps to the original mdx-prose elements',()=>{
 const {nodes,warnings}=renderMarkdown('Hello **b** and *e* ~~d~~ `c`');
 assert.deepEqual(warnings,[]);
 const [p]=els(nodes);
 assert.equal(p.tag,'p');
 assert.deepEqual(els(p.children).map(e=>e.tag),['strong','em','del','code']);
 assert.equal(text(p),'Hello b and e d c');
});

test('headings get github-slugger ids matching captured table-of-contents anchors',()=>{
 const {nodes,headings}=renderMarkdown('## 경쟁도 0.37이 의미하는 것\n\n### "어떤 글을 더 써야 하지?"의 가장 답답한 부분\n\n## 경쟁도 0.37이 의미하는 것');
 assert.deepEqual(els(nodes).map(e=>e.attrs.id),['경쟁도-037이-의미하는-것','어떤-글을-더-써야-하지의-가장-답답한-부분','경쟁도-037이-의미하는-것-1']);
 assert.deepEqual(headings.map(h=>[h.depth,h.id]),[[2,'경쟁도-037이-의미하는-것'],[3,'어떤-글을-더-써야-하지의-가장-답답한-부분'],[2,'경쟁도-037이-의미하는-것-1']]);
});

test('unsafe link and image protocols are dropped, safe ones kept',()=>{
 const {nodes,warnings}=renderMarkdown('[a](javascript:alert(1)) [b](/pricing) [c](https://example.com) [d](mailto:a@b.c) [e](#top) [f](data:text/html,x)\n\n![x](javascript:alert(1))');
 const links=els(els(nodes)[0].children);
 assert.deepEqual(links.map(a=>a.attrs.href),[undefined,'/pricing','https://example.com','mailto:a@b.c','#top',undefined]);
 assert.ok(warnings.some(w=>w.includes('javascript:')));
 assert.equal(JSON.stringify(nodes).includes('javascript'),false);
});

test('external links open safely in a new tab',()=>{
 const [a]=els(els(renderMarkdown('[c](https://example.com)').nodes)[0].children);
 assert.equal(a.attrs.target,'_blank');
 assert.equal(a.attrs.rel,'noopener noreferrer');
});

test('raw html is rendered as inert text, never as elements',()=>{
 const {nodes,warnings}=renderMarkdown('<script>alert(1)</script>\n\nhi <img src=x onerror=alert(1)>');
 const json=JSON.stringify(nodes);
 assert.equal(/"tag":"(script|img)"/.test(json),false);
 assert.ok(json.includes('<script>alert(1)</script>'));
 assert.ok(warnings.some(w=>w.includes('HTML')));
});

test('images use the captured skeleton wrapper with next/image attributes',()=>{
 const {nodes}=renderMarkdown('![설명](/assets/86ebda198a50ebba.webp)',{imageSize:()=>({width:2400,height:1200})});
 const [p]=els(nodes);const [span]=els(p.children);const [img]=els(span.children);
 assert.equal(span.attrs.class,'mdx-img-skeleton');
 assert.deepEqual(img.attrs,{alt:'설명',loading:'lazy',width:'2400',height:'1200',decoding:'async','data-nimg':'1',class:'',style:'color:transparent',sizes:'(max-width: 900px) 100vw, 900px',src:'/assets/86ebda198a50ebba.webp'});
});

test('images without known size omit dimension attributes',()=>{
 const {nodes}=renderMarkdown('![a](/assets/none.webp)',{imageSize:()=>null});
 const img=els(els(els(nodes)[0].children)[0].children)[0];
 assert.deepEqual(img.attrs,{alt:'a',loading:'lazy',decoding:'async',class:'',src:'/assets/none.webp'});
});

test('colons in text do not split text nodes or create directives',()=>{
 const [p]=els(renderMarkdown('마감 23:59, 비율 기존:신규 7:3').nodes);
 assert.deepEqual(p.children,['마감 23:59, 비율 기존:신규 7:3']);
});

test('gfm tables, lists, blockquotes and rules keep structure',()=>{
 const md='| 방식 | 경품 |\n|---|---|\n| **a** | `b` |\n\n1. one\n2. two\n\n- x\n\n> quote\n\n---';
 const tags=els(renderMarkdown(md).nodes).map(e=>e.tag);
 assert.deepEqual(tags,['table','ol','ul','blockquote','hr']);
 const table=els(renderMarkdown(md).nodes)[0];
 assert.deepEqual(els(table.children).map(e=>e.tag),['thead','tbody']);
});

test('block children are separated by newline text nodes like the captured prose',()=>{
 const {nodes}=renderMarkdown('a\n\nb');
 assert.deepEqual(nodes.map(n=>typeof n==='string'?n:n.tag),['p','\n','p']);
});

test('supported directives render the captured components',()=>{
 const md=[
  ':::event-cta{href="/event/naeo-review" label="이벤트 참여하기" aria="콘텐츠 URL 제출" button="true"}','9월 27일까지 · 한 줄 평',':::','',
  '::event-cta{href="/event/naeo-review" label="이벤트 참여하기"}','',
  '::picture{src="/assets/0cf7d6ef2e8bfc03.webp" alt="이벤트"}','',
  '::mate-promo'
 ].join('\n');
 const {nodes,warnings}=renderMarkdown(md);
 assert.deepEqual(warnings,[]);
 // button="true" 는 원본처럼 상자와 모바일 버튼을 줄바꿈 없이 붙여 렌더링한다.
 assert.deepEqual(nodes.map(n=>typeof n==='string'?'NL':n.tag),['aside','div','NL','aside','NL','picture','NL','aside']);
 const [cta,button,bare,picture,promo]=els(nodes);
 assert.equal(cta.attrs['aria-label'],'콘텐츠 URL 제출');
 assert.equal(els(cta.children)[0].attrs.href,'/event/naeo-review');
 assert.equal(text(els(cta.children)[1]),'9월 27일까지 · 한 줄 평');
 assert.equal(els(button.children)[0].attrs.href,'/event/naeo-review');
 assert.equal(els(bare.children).length,1);
 assert.deepEqual(els(picture.children).map(e=>e.tag),['source','img']);
 assert.ok(text(promo).includes('30초 무료 진단받기'));
});

test('tables have no whitespace text nodes, like the React-rendered original',()=>{
 const [table]=els(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |').nodes);
 const ws=(n:CapturedNode):boolean=>typeof n==='string'?n.trim()==='':n.tag!=='td'&&n.tag!=='th'&&n.children.some(ws);
 assert.equal(ws(table),false);
});

test('tight list items follow mdast-util-to-hast newline placement',()=>{
 const [ol]=els(renderMarkdown('1. text\n   - nested\n2. b').nodes);
 const [li]=els(ol.children);
 assert.deepEqual(li.children.map(n=>typeof n==='string'?n:n.tag),['text','\n','ul','\n']);
});

test('directive hrefs are protocol-checked and unknown directives are rejected with warnings',()=>{
 const {nodes,warnings}=renderMarkdown('::event-cta{href="javascript:alert(1)" label="x"}\n\n::evil{a="b"}');
 assert.equal(JSON.stringify(nodes).includes('javascript'),false);
 assert.ok(warnings.some(w=>w.includes('evil')));
 assert.ok(warnings.some(w=>w.includes('javascript:')));
});

test('oversized input is refused',()=>{
 assert.throws(()=>renderMarkdown('a'.repeat(200_001)),/too large/);
});
