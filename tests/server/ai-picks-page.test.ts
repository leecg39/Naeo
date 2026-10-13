import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildAiPicksPage} from '../../src/server/analysis/ai-picks-page';
import type {CapturedNode,CapturedPageData} from '../../src/types/site';

type El=Exclude<CapturedNode,string>;
const all=(nodes:CapturedNode[],f:(n:El)=>boolean,out:El[]=[]):El[]=>{for(const n of nodes){if(typeof n==='string')continue;if(f(n))out.push(n);all(n.children,f,out);}return out;};
const text=(n:CapturedNode):string=>typeof n==='string'?n:n.children.map(text).join('');
const has=(c:string)=>(n:El)=>(n.attrs.class??'').split(/\s+/).includes(c);
const index=JSON.parse(readFileSync('src/data/page-index.json','utf8')) as Record<string,string>;
const captured=JSON.parse(readFileSync('src/data/pages/'+index['/dashboard/ai-picks'],'utf8')) as CapturedPageData;

test('AI picks page shows an honest not-configured state without the captured account data',async()=>{
 const page=await buildAiPicksPage();
 const capturedRows=all(captured.body,has('mui-uien4a'))[0].children.length;
 assert.ok(capturedRows>10,'capture had rows');
 assert.equal(all(page.body,has('mui-uien4a'))[0].children.filter(c=>typeof c!=='string').length,1,'only the empty-state row');
 assert.match(text(all(page.body,has('mui-uien4a'))[0]),/미설정/);
 const metrics=all(page.body,n=>n.attrs['aria-label']==='AI 인용 현황 핵심 지표')[0];
 assert.ok(!/\d/.test(text(metrics)),'no captured metric numbers');
 assert.match(text(all(page.body,has('mui-1ptiu1r'))[0]),/설정되지 않았/);
 const tabs=all(page.body,has('mui-d7s6pe'))[0];
 assert.ok(!/[1-9]/.test(text(tabs)),'filter counts are zero');
 assert.ok(!/[1-9]/.test(text(all(page.body,has('mui-1aa9dm1'))[0])),'no captured distribution numbers');
});
