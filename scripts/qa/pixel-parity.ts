/** Pixel-level comparison of the clone vs the live original (naeo.kr).
 * Captures viewport + full-page screenshots of both sites through the system
 * Chrome (headless) and compares them with pixelmatch. Produces
 * docs/fullstack/evidence/pixel-parity-{date}/{route}.{w}.{side}.png,
 * .diff.png and report.json. Ratios are evidence, not a pass gate — the
 * original is a live site with dynamic content.
 *
 * Usage: node --import tsx scripts/qa/pixel-parity.ts [--base http://127.0.0.1:3200] [--orig https://www.naeo.kr]
 */
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';

const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROUTES=['/','/pricing','/contact','/mate','/blog','/event','/ranking','/faq','/features','/login'];
const VIEWPORTS=[{w:1440,h:900,name:'desktop'},{w:390,h:844,name:'mobile'}];
const SETTLE_MS=2500;
const args=process.argv.slice(2);
const opt=(name:string,fallback:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
const base=opt('--base','http://127.0.0.1:3200'),orig=opt('--orig','https://www.naeo.kr');
const outDir=resolve('docs/fullstack/evidence',`pixel-parity-2026-10-16`);
mkdirSync(outDir,{recursive:true});

type Shot={png:PNG;docH:number;scrollW:number};
async function shoot(browser:import('puppeteer-core').Browser,url:string,vp:{w:number;h:number}):Promise<Shot>{
 const page=await browser.newPage();
 try{
  await page.setViewport({width:vp.w,height:vp.h,deviceScaleFactor:1,isMobile:vp.w<500,hasTouch:vp.w<500});
  await page.goto(url,{waitUntil:'networkidle0',timeout:60000});
  await new Promise(r=>setTimeout(r,SETTLE_MS));
  const metrics=await page.evaluate(()=>({docH:document.documentElement.scrollHeight,scrollW:document.documentElement.scrollWidth}));
  const buf=await page.screenshot({fullPage:true});
  return{png:PNG.sync.read(Buffer.from(buf)),...metrics};
 }finally{await page.close();}
}
/** Compare the shared prefix region of two full-page shots (equal widths required). */
function diff(a:PNG,b:PNG){const w=Math.min(a.width,b.width),h=Math.min(a.height,b.height);const out=new PNG({width:w,height:h});
 const crop=(s:PNG)=>{if(s.width===w&&s.height===h)return s;const c=new PNG({width:w,height:h});PNG.bitblt(s,c,0,0,w,h,0,0);return c;};
 const n=pixelmatch(crop(a).data,crop(b).data,out.data,w,h,{threshold:0.1,includeAA:false});
 return{pixels:n,ratio:n/(w*h),png:out,comparedH:h};}

async function main(){
 const browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--hide-scrollbars','--force-device-scale-factor=1']});
 const report:{generatedAt:string;orig:string;clone:string;rows:Record<string,unknown>[]}={
  generatedAt:new Date().toISOString(),orig,clone:base,rows:[]};
 try{
  for(const route of ROUTES){
   for(const vp of VIEWPORTS){
    const name=`${route==='/'?'index':route.replaceAll('/','_').slice(1)}.${vp.name}`;
    const o=await shoot(browser,orig+route,vp),c=await shoot(browser,base+route,vp);
    writeFileSync(join(outDir,`${name}.orig.png`),PNG.sync.write(o.png));
    writeFileSync(join(outDir,`${name}.clone.png`),PNG.sync.write(c.png));
    const d=diff(o.png,c.png);
    writeFileSync(join(outDir,`${name}.diff.png`),PNG.sync.write(d.png));
    report.rows.push({route,viewport:vp.name,origDocH:o.docH,cloneDocH:c.docH,comparedH:d.comparedH,
     comparedW:Math.min(o.png.width,c.png.width),widthMismatch:o.png.width!==c.png.width,
     fullDocHMismatch:o.docH!==c.docH,diffPixels:d.pixels,diffRatio:+d.ratio.toFixed(4),
     scrollW:{orig:o.scrollW,clone:c.scrollW},overflowX:o.scrollW>vp.w||c.scrollW>vp.w});
    console.log(`${route.padEnd(10)} ${vp.name}: diff=${(d.ratio*100).toFixed(2)}% (${d.pixels}px) docH ${o.docH}/${c.docH} scrollW ${o.scrollW}/${c.scrollW}`);
   }
  }
 }finally{await browser.close();}
 writeFileSync(join(outDir,'report.json'),JSON.stringify(report,null,1));
 console.log(`\nreport: ${join(outDir,'report.json')}`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
