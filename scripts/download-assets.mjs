import fs from 'node:fs/promises';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');const manifest=JSON.parse(await fs.readFile(path.join(root,'docs/research/naeo.kr/assets.json'),'utf8'));
manifest.push({url:'https://www.naeo.kr/icon.png',local:'/seo/icon.png'},{url:'https://www.naeo.kr/apple-icon.png',local:'/seo/apple-icon.png'});
const results=[];let cursor=0;
async function worker(){while(cursor<manifest.length){const a=manifest[cursor++];const dest=path.join(root,'public',a.local);try{await fs.mkdir(path.dirname(dest),{recursive:true});if(!(await fs.stat(dest).catch(()=>null))){const r=await fetch(a.url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`HTTP ${r.status}`);await fs.writeFile(dest,Buffer.from(await r.arrayBuffer()));}results.push({...a,ok:true,bytes:(await fs.stat(dest)).size})}catch(e){results.push({...a,ok:false,error:String(e)})}}}
await Promise.all(Array.from({length:4},worker));await fs.writeFile(path.join(root,'docs/research/naeo.kr/assets-download.json'),JSON.stringify(results,null,2));console.log({assets:results.length,downloaded:results.filter(r=>r.ok).length,failures:results.filter(r=>!r.ok)});
