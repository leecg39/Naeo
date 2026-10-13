const capturePage="p2";
const captureRoutes=["/", "/mcp", "/pricing", "/ranking", "/mate", "/blog", "/updates", "/faq", "/contact", "/features", "/guide/writing", "/guide/extension-publish"];
// Run with: ego-browser nodejs < scripts/capture-browser.mjs
const fs=await import('node:fs/promises');
const root='/Users/user01/Desktop/NAEO/naeo-clone';
const task=await taskSpace(5);
const page=task.page(typeof capturePage==='undefined'?'p1':capturePage);
const routes=typeof captureRoutes==='undefined'?['/dashboard']:captureRoutes;
const width=typeof captureWidth==='undefined'?1440:captureWidth;
await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
for(const route of routes){
 const slug=(route==='/'?'home':route.slice(1).replaceAll('/','--'))+`-${width}`;
 await page.goto('https://www.naeo.kr'+route);
 await page.waitForFunction(()=>document.body.innerText.length>80&&!document.querySelector('[aria-label="대시보드 로딩 중"]'),undefined,{timeout:12000}).catch(()=>{});
 const data=await page.evaluate(()=>{
  const clone=document.body.cloneNode(true);
  clone.querySelectorAll('script,iframe,noscript,next-route-announcer').forEach(e=>e.remove());
  const css=[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules].map(r=>r.cssText)}catch{return []}}).join('\n');
  const props=['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','backgroundColor','backgroundImage','display','position','padding','margin','gap','border','borderRadius','boxShadow','width','maxWidth','height','opacity','transform','transition','gridTemplateColumns','overflow','zIndex'];
  const elements=[...document.querySelectorAll('header,nav,main,footer,h1,h2,h3,h4,[role="tablist"],[role="tab"],button,input,textarea,video')];
  return {path:location.pathname,url:location.href,title:document.title,html:clone.innerHTML,css,bodyClass:document.body.className,rootClass:document.documentElement.className,viewport:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight},computed:elements.slice(0,180).map(e=>({tag:e.tagName,class:e.className,ariaLabel:e.getAttribute('aria-label'),text:e.innerText?.slice(0,140),styles:Object.fromEntries(props.map(p=>[p,getComputedStyle(e)[p]]))})),images:[...document.images].filter(e=>e.getBoundingClientRect().width>1).map(e=>({src:e.currentSrc||e.src,alt:e.alt,width:e.naturalWidth,height:e.naturalHeight,position:getComputedStyle(e).position})),videos:[...document.querySelectorAll('video')].map(e=>({src:e.currentSrc||e.src,poster:e.poster,loop:e.loop,muted:e.muted,autoplay:e.autoplay})),links:[...document.querySelectorAll('a')].map(e=>({text:e.innerText,href:e.getAttribute('href')}))};
 });
 data.requestedPath=route;data.capturedAt=new Date().toISOString();
 await fs.writeFile(`${root}/docs/research/naeo.kr/runtime-${slug}.json`,JSON.stringify(data));
 try{await page.screenshot({path:`${root}/docs/design-references/naeo.kr/${slug}.png`,fullPage:true});}catch(e){console.log({route,screenshotError:e.message});}
 console.log({route,finalPath:data.path,width,htmlBytes:data.html.length,cssBytes:data.css.length});
}
await page.cdp('Emulation.clearDeviceMetricsOverride');
