// node scripts/run-browser-qa.mjs <batch 0..8>
// Reuse the handoff task space. Batch size limits each browser round.
const fs = await import('node:fs/promises');
const root = process.env.NAEO_QA_ROOT || '/Users/user01/Desktop/NAEO/naeo-clone';
const out = `${root}/docs/fullstack/browser-qa`;
await fs.mkdir(out, {recursive:true});
const base = process.env.NAEO_AUDIT_BASE || 'http://127.0.0.1:3100';
const routes = JSON.parse(await fs.readFile(`${root}/docs/fullstack/page-coverage.json`, 'utf8')).map(r=>r.path);
routes.push('/admin/pages','/admin/faq','/admin/updates','/admin/announcements','/admin/billing','/admin/payments','/dashboard/social');
const samples = {'/blog/:category/:slug':'/blog/guide/dashboard-guide','/dashboard/events/:slug':'/dashboard/events/naeo-review','/event/:slug':'/event/naeo-review','/p/:id/images':'/p/AAAAAAAAAAAAAAAAAAAAAA/images'};
const views = {desktop:{width:1440,height:900},tablet:{width:820,height:1180},mobile:{width:390,height:844}};
const batch = Number(process.env.NAEO_QA_BATCH || 0);
const selected = routes.slice(batch*10, (batch+1)*10);
const task = await taskSpace(Number(process.env.NAEO_QA_SPACE || 7));
const page = task.page('p1');
await page.cdp('Runtime.enable',{});
await page.cdp('Log.enable',{});
await page.cdp('Network.enable',{});
const results = [];
const capture = new Set(['/','/admin/blog','/pricing']);
for (const route of selected) {
 for (const [view,dimensions] of Object.entries(views)) {
  await page.cdp('Emulation.setDeviceMetricsOverride',{...dimensions,deviceScaleFactor:1,mobile:view!=='desktop'});
  await page.events();
  // An unexpected browser/control error aborts the round for inspection.
  await page.goto(base+(samples[route]||route),{waitUntil:'load',timeout:20000});
  if(await page.evaluate(()=>!!document.querySelector('[data-naeo-captured-root]')))
   await page.waitForFunction(()=>document.querySelector('[data-naeo-ready="true"]'),undefined,{timeout:10000});
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  if(route==='/')await page.waitForFunction(()=>document.querySelector('#landing-v2-main h1 [aria-hidden=true]')?.textContent==='내 블로그 포스팅',undefined,{timeout:10000});
  if(route==='/')await page.waitForFunction(()=>[...document.querySelectorAll('#landing-v2-main h1 [style]')].every(e=>getComputedStyle(e).filter==='none'||getComputedStyle(e).filter==='blur(0px)'),undefined,{timeout:10000});
  const events = await page.events();
  const errors = events.filter(e=>e.method==='Runtime.exceptionThrown'||(e.method==='Runtime.consoleAPICalled'&&e.params?.type==='error')||(e.method==='Log.entryAdded'&&e.params?.entry?.level==='error'))
   .map(e=>(e.params?.exceptionDetails?.exception?.description||e.params?.args?.map(a=>a.value??a.description).join(' ')||e.params?.entry?.text||'').slice(0,400));
  const responses = events.filter(e=>e.method==='Network.responseReceived');
  const failed = responses.filter(e=>e.params.response.status>=400&&e.params.response.url.startsWith(base)&&e.params.type!=='Document').map(e=>({status:e.params.response.status,url:e.params.response.url.replace(base,''),type:e.params.type}));
  const layout = await page.evaluate(()=>({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,final:location.pathname+location.search,heading:document.querySelector('h1')?.textContent?.slice(0,100)||'',crashed:/Application error|Internal Server Error/.test(document.body.innerText)}));
  const row={route,view,at:new Date().toISOString(),status:responses.filter(e=>e.params.type==='Document').at(-1)?.params.response.status,...layout,overflow:layout.scrollWidth-layout.width,errors,failed};
  if(capture.has(route)) {
   const file=`${route==='/'?'home':route.slice(1).replaceAll('/','-')}-${view}.png`;
   await page.screenshot({path:`${out}/${file}`});row.screenshot=file;
  }
  results.push(row);
  await fs.writeFile(`${out}/batch-${batch}.json`,JSON.stringify(results,null,2)+'\n');
 }
 console.log({route,checks:results.length,issues:results.filter(r=>r.crashed||r.overflow>0||r.errors.length||r.failed.length||r.status>=500).length});
}
await page.cdp('Emulation.clearDeviceMetricsOverride',{});
console.log({batch,routes:selected.length,checks:results.length});
