/** Animation parity probe: measure what actually animates on the live
 * original vs the clone — running CSS/WAAPI animations, elements waiting
 * for scroll-reveal (opacity 0), transitions, and marquee-style loops.
 * Evidence only, not a pass gate.
 *
 * Usage: node --import tsx scripts/qa/animation-parity.ts [--base http://127.0.0.1:3200] [--orig https://www.naeo.kr]
 */
import puppeteer from 'puppeteer-core';

const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROUTES=['/','/ranking','/pricing','/mate'];
const args=process.argv.slice(2);
const opt=(n:string,f:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:f;};
const base=opt('--base','http://127.0.0.1:3200'),orig=opt('--orig','https://www.naeo.kr');

async function measure(browser:import('puppeteer-core').Browser,url:string,scroll:boolean){
 const page=await browser.newPage();
 try{
  await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
  await page.goto(url,{waitUntil:'networkidle0',timeout:60000});
  await new Promise(r=>setTimeout(r,2500));
  if(scroll){
   // Reveal-pass: scroll through the document so IntersectionObserver reveals fire.
   await page.evaluate(async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<h;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}window.scrollTo(0,0);await new Promise(r=>setTimeout(r,400));});
   await new Promise(r=>setTimeout(r,1200));
  }
  return await page.evaluate(()=>{
   const els=Array.from(document.querySelectorAll<HTMLElement>('*'));
   const anims=document.getAnimations();
   const running=anims.filter(a=>a.playState==='running');
   const cssAnims=running.filter(a=>a.constructor.name==='CSSAnimation');
   const hidden=els.filter(e=>{const s=getComputedStyle(e);return s.opacity==='0';}).length;
   const transitioning=els.filter(e=>{const s=getComputedStyle(e);return s.transitionProperty!=='none'&&s.transitionProperty!=='all';}).length;
   const names=cssAnims.map(a=>(a as CSSAnimation).animationName).filter(Boolean);
   const nameCount:Record<string,number>={};for(const n of names)nameCount[n]=(nameCount[n]||0)+1;
   // Inline opacity:0 = captured mid-animation state awaiting reveal
   const inlineHidden=els.filter(e=>e.style.opacity==='0').length;
   return{animTotal:running.length,cssAnimTotal:cssAnims.length,animNames:nameCount,computedOpacityZero:hidden,inlineOpacityZero:inlineHidden,transitioning};
  });
 }finally{await page.close();}
}

async function main(){
 const browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox']});
 const out:Record<string,unknown>={};
 for(const route of ROUTES){
  for(const [tag,root] of [['orig',orig],['clone',base]] as const){
   try{
    const pre=await measure(browser,root+route,false);
    const post=await measure(browser,root+route,true);
    out[`${route} ${tag}`]={preScroll:pre,postScroll:post};
   }catch(e){out[`${route} ${tag}`]={error:String(e).slice(0,160)};}
  }
 }
 await browser.close();
 console.log(JSON.stringify(out,null,1));
}
void main();
