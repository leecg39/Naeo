import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
const root=path.resolve(import.meta.dirname,'..');
const source=path.resolve(root,'../reverse-engineering/evidence/page-discovery');
const inventory=JSON.parse(await fs.readFile(path.join(source,'pages.json'),'utf8'));
const out=path.join(root,'src/data/pages');await fs.mkdir(out,{recursive:true});
const assets=new Map();const icons=new Map();
function asset(value){
 if(!value||value.startsWith('data:')||value.startsWith('blob:')||value.startsWith('#'))return value;
 const u=new URL(value,'https://www.naeo.kr');
 if(u.pathname==='/_next/image')return asset(u.searchParams.get('url'));
 if(!['https:','http:'].includes(u.protocol))return value;
 if(/googletagmanager|facebook|twitter|clarity\.ms|analytics|doubleclick/.test(u.hostname))return '';
 const ext=path.extname(u.pathname)||'.bin';
 const local='/assets/'+crypto.createHash('sha256').update(u.href).digest('hex').slice(0,16)+ext;
 assets.set(u.href,{url:u.href,local});return local;
}
function cssAssets(css){return css.replace(/url\(["']?([^)'"\s]+)["']?\)/g,(all,url)=>`url("${asset(url)}")`)}
function link(href){if(!href)return href;try{const u=new URL(href,'https://www.naeo.kr');return ['naeo.kr','www.naeo.kr'].includes(u.hostname)?u.pathname+u.search+u.hash:href}catch{return href}}
function node(n){
 if(n.type==='text')return n.data;
 if(n.type!=='tag')return null;
 const tag=n.name.toLowerCase();if(['script','style','noscript','iframe','next-route-announcer','link','meta','title'].includes(tag))return null;
 const attrs={};for(const [k,v]of Object.entries(n.attribs||{})){
  if(k.startsWith('on')||k==='nonce'||k==='data-emotion'||k==='fetchpriority'||k==='srcset')continue;
  if(k==='src'||k==='poster'){attrs[k]=asset(v);continue;}
  if(k==='href'){attrs[k]=link(v);continue;}
  if(k==='style'){attrs[k]=cssAssets(v);continue;}
  if(k==='id'&&/^[SB]:/.test(v))continue;
  attrs[k]=v;
 }
 if(tag==='input'&&['password','email'].includes(attrs.type))delete attrs.value;
 const children=(n.children||[]).map(node).filter(x=>x!==null);
 return {tag,attrs,children};
}
const index={};
for(const item of inventory.pages.filter(p=>p.status===200)){
 const html=await fs.readFile(path.join(source,item.file),'utf8');const $=cheerio.load(html);
 const css=cssAssets($('style').toArray().map(e=>$(e).html()).join('\n'));
 // React streaming containers carry actual SSR content. Unwrap them; remove empty suspense placeholders.
 $('div[id^="S:"]').each((_,e)=>$(e).replaceWith($(e).contents()));
 $('template[id^="B:"]').remove();
 $('body > div[hidden]').each((_,e)=>{if(!$(e).text().trim())$(e).remove()});
 const body=$('body').contents().toArray().map(node).filter(x=>x!==null && (typeof x!=='string'||x.trim()));
 const slug=item.path==='/'?'home':item.path.slice(1).replaceAll('/','--');
 const data={path:item.path,title:item.title,description:$('meta[name="description"]').attr('content')||'',css,body,source:item.url,capturedAt:item.captured_at};
 await fs.writeFile(path.join(out,slug+'.json'),JSON.stringify(data));
 index[item.path]=slug+'.json';
 $('svg').slice(0,100).each((_,e)=>{const markup=$.html(e);const key=crypto.createHash('sha256').update(markup).digest('hex').slice(0,12);icons.set(key,markup)});
}
await fs.writeFile(path.join(root,'src/data/page-index.json'),JSON.stringify(index,null,2));
await fs.writeFile(path.join(root,'docs/research/naeo.kr/assets.json'),JSON.stringify([...assets.values()],null,2));
await fs.mkdir(path.join(root,'public/assets/icons'),{recursive:true});
for(const [id,svg]of icons)await fs.writeFile(path.join(root,'public/assets/icons',id+'.svg'),svg);
console.log({pages:Object.keys(index).length,assets:assets.size,icons:icons.size});
