import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.NAEO_BASE_URL||'http://127.0.0.1:3000';
const pages=JSON.parse(await fs.readFile('../reverse-engineering/evidence/page-discovery/pages.json','utf8')).pages;
const index=JSON.parse(await fs.readFile('src/data/page-index.json','utf8'));
const result=[];let cursor=0;
async function worker(){while(cursor<pages.length){const item=pages[cursor++];const res=await fetch(base+item.path,{redirect:'manual'});const html=await res.text();const location=res.headers.get('location');const mode=index[item.path]?'화면':'리디렉션';const expected=mode==='화면'?200:item.path.startsWith('/updates/')?308:307;result.push({path:item.path,mode,status:res.status,expected,ok:res.status===expected&&!!(location||html.includes('NAEO')),location,title:html.match(/<title>(.*?)<\/title>/s)?.[1]||'',bytes:html.length});}}
await Promise.all([worker(),worker(),worker()]);result.sort((a,b)=>a.path.localeCompare(b.path));
await fs.writeFile('docs/research/route-qa.json',JSON.stringify({base,checkedAt:new Date().toISOString(),count:result.length,passed:result.filter(r=>r.ok).length,routes:result},null,2));
console.log({count:result.length,passed:result.filter(r=>r.ok).length,failed:result.filter(r=>!r.ok)});assert.equal(result.length,79);assert.ok(result.every(r=>r.ok));
