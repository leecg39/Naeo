import type {InstallBehavior} from '../../lib/behavior';

const STAGE_DURATION = [5000, 2500, 8000, 8000, 4000];

/** Restores the captured example panels without generating, saving, or publishing a real post. */
export const installHomeDemo:InstallBehavior = (root) => {
 const demo=root.querySelector<HTMLElement>('[data-naeo-home-demo="writing"]');
 if(!demo)return;
 const controls=root.querySelector<HTMLElement>('[data-naeo-demo-controls="writing"]');
 const panels=[...demo.querySelectorAll<HTMLElement>('[data-naeo-demo-panel]')];
 const buttons=[...controls?.querySelectorAll<HTMLButtonElement>('[data-naeo-demo-select]')??[]];
 const play=controls?.querySelector<HTMLButtonElement>('[data-naeo-demo-play]');
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 const cleanup:(()=>void)[]=[];
 const snapshots=new Map<Element,Map<string,string|null>>();
 const remember=(element:Element,...names:string[])=>{
  const attrs=snapshots.get(element)??new Map<string,string|null>();
  names.forEach(name=>{if(!attrs.has(name))attrs.set(name,element.getAttribute(name));});
  snapshots.set(element,attrs);
 };
 remember(demo,'data-demo-step');
 panels.forEach(panel=>remember(panel,'aria-hidden','inert','style'));
 buttons.forEach(button=>remember(button,'aria-pressed'));
 const playText=play?.textContent;
 if(play)remember(play,'aria-pressed');
 let index=0,playing=!motion.matches,visible=false,hovering=false,focused=false;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const on=(target:EventTarget,type:string,listener:EventListener)=>{target.addEventListener(type,listener);cleanup.push(()=>target.removeEventListener(type,listener));};
 const schedule=()=>{
  if(timer)clearTimeout(timer);
  if(playing&&visible&&!hovering&&!focused&&!document.hidden)timer=setTimeout(()=>show((index+1)%panels.length),STAGE_DURATION[index]);
 };
 const show=(next:number)=>{
  index=Math.max(0,Math.min(panels.length-1,next));
  demo.dataset.demoStep=String(index);
  panels.forEach((panel,i)=>{panel.setAttribute('aria-hidden',String(i!==index));panel.inert=i!==index;panel.style.opacity=i===index?'1':'0';});
  buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  if(play){play.textContent=playing?'일시정지':'예시 재생';play.setAttribute('aria-pressed',String(playing));}
  schedule();
 };
 const manual=(next:number)=>{playing=false;show(next);};
 if(typeof IntersectionObserver!=='undefined'){
  const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);schedule();},{threshold:.3});
  observer.observe(demo);cleanup.push(()=>observer.disconnect());
 }else visible=true;
 on(demo,'pointerenter',()=>{hovering=true;schedule();});
 on(demo,'pointerleave',()=>{hovering=false;schedule();});
 on(demo,'focusin',()=>{focused=true;schedule();});
 on(demo,'focusout',event=>{focused=demo.contains((event as FocusEvent).relatedTarget as Node|null);schedule();});
 on(document,'visibilitychange',schedule);
 on(motion,'change',()=>{if(motion.matches){playing=false;show(index);}});
 on(root,'click',event=>{
  const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-naeo-demo-select],[data-naeo-demo-play],[data-naeo-demo-action]'):null;
  if(!target||!root.contains(target))return;
  event.preventDefault();
  if(target.hasAttribute('data-naeo-demo-play')){playing=!playing;show(index);}
  else manual(Number(target.dataset.naeoDemoSelect??target.dataset.naeoDemoAction));
 });
 on(demo,'keydown',event=>{
  const key=event as KeyboardEvent;
  const target=key.target instanceof Element?key.target.closest<HTMLElement>('[data-naeo-demo-action]'):null;
  if(target&&(key.key==='Enter'||key.key===' ')){key.preventDefault();manual(Number(target.dataset.naeoDemoAction));}
 });
 // The source rotates these two brand headings. Keep exactly the selected one exposed.
 const brandGroup=root.querySelector<HTMLElement>('[aria-label="데모에서 볼 AI 선택"]');
 const brandButtons=[...brandGroup?.querySelectorAll<HTMLButtonElement>('button')??[]];
 const mcp=brandGroup?.parentElement;
 const heading=root.querySelector('#step-03 h3');
 const headingBrands=[...heading?.querySelectorAll<HTMLElement>('span[aria-hidden]')??[]];
 const texts:{node:Text;original:string}[]=[];
 if(mcp){
  const walker=document.createTreeWalker(mcp,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
   const node=walker.currentNode as Text;
   if(!brandGroup?.contains(node)&&/ChatGPT/.test(node.data))texts.push({node,original:node.data});
  }
 }
 const imageTools=mcp?[...mcp.querySelectorAll('code')].filter(code=>code.textContent==='upload_image').map(code=>code.parentElement).filter((row):row is HTMLElement=>row!==null):[];
 brandButtons.forEach(button=>remember(button,'aria-pressed','style'));
 headingBrands.forEach(span=>remember(span,'aria-hidden','style'));
 imageTools.forEach(row=>remember(row,'hidden'));
 mcp?.querySelectorAll('[role="group"][aria-label]').forEach(group=>remember(group,'aria-label'));
 const selectBrand=(provider:'ChatGPT'|'Claude')=>{
  brandButtons.forEach(button=>{const active=button.textContent?.trim()===provider;button.setAttribute('aria-pressed',String(active));button.style.backgroundColor=active?'rgba(3,199,90,.12)':'transparent';button.style.color=active?'#03c75a':'#a3a3a3';});
  headingBrands.forEach((span,i)=>{const active=i===(provider==='Claude'?1:0);span.setAttribute('aria-hidden',String(!active));span.style.opacity=active?'1':'0';span.style.visibility=active?'visible':'hidden';});
  texts.forEach(({node,original})=>{node.data=provider==='Claude'?original.replace(/ChatGPT(?: 5\.6)?/g,'Claude'):original;});
  imageTools.forEach(row=>{row.hidden=provider==='Claude';});
  mcp?.querySelectorAll<HTMLElement>('[role="group"][aria-label]').forEach(group=>{const value=group.getAttribute('aria-label');if(value)group.setAttribute('aria-label',value.replace(/ChatGPT|Claude/g,provider));});
 };
 on(root,'click',event=>{
  const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button'):null;
  if(!button||!brandButtons.includes(button))return;
  event.preventDefault();selectBrand(button.textContent?.trim()==='Claude'?'Claude':'ChatGPT');
 });
 show(motion.matches?panels.length-1:0);
 selectBrand('ChatGPT');
 return()=>{
  if(timer)clearTimeout(timer);
  cleanup.reverse().forEach(fn=>fn());
  texts.forEach(({node,original})=>{node.data=original;});
  if(play)play.textContent=playText??'';
  snapshots.forEach((attrs,element)=>attrs.forEach((value,name)=>value===null?element.removeAttribute(name):element.setAttribute(name,value)));
 };
};
