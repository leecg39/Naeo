import {fromMarkdown} from 'mdast-util-from-markdown';
import {gfm} from 'micromark-extension-gfm';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {directive} from 'micromark-extension-directive';
import {directiveFromMarkdown} from 'mdast-util-directive';
import GithubSlugger from 'github-slugger';
import type * as M from 'mdast';
import type {ContainerDirective,LeafDirective,TextDirective} from 'mdast-util-directive';
import type {CapturedNode} from '../../types/site';
import {assetImageSize,type ImageSize} from './image-size';
import {ctaButton,eventCta,matePromo,picture} from './components';

type El=Exclude<CapturedNode,string>;
type Directive=ContainerDirective|LeafDirective|TextDirective;
export type Heading={depth:number;id:string;text:string};
export type RenderOptions={imageSize?:(src:string)=>ImageSize|null};
export type RenderResult={nodes:CapturedNode[];headings:Heading[];warnings:string[];text:string};

export const MAX_MARKDOWN=200_000;
const SAFE_LINK=/^(?:https?:\/\/|mailto:|#|\/(?!\/))/i;
const SAFE_IMAGE=/^(?:https:\/\/|\/(?!\/))/i;

const el=(tag:string,attrs:Record<string,string>={},children:CapturedNode[]=[]):El=>({tag,attrs,children});
/** remark-rehype와 같이 블록 자식 사이(와 선택적으로 앞뒤)에 줄바꿈 텍스트를 둔다. */
function wrap(children:CapturedNode[],around:boolean):CapturedNode[]{return wrapGroups(children.map(c=>[c]),around);}
/** 한 블록이 여러 노드(예: 상자+모바일 버튼)를 낼 때 그 사이에는 줄바꿈을 넣지 않는다. */
function wrapGroups(groups:CapturedNode[][],around:boolean):CapturedNode[]{
 const out:CapturedNode[]=around?['\n']:[];
 groups.filter(g=>g.length).forEach((g,i)=>{if(i)out.push('\n');out.push(...g);});
 if(around&&out.length>1)out.push('\n');
 return out;
}
function plain(node:M.Nodes):string{
 if('value' in node&&typeof node.value==='string')return node.value;
 return 'children' in node?(node.children as M.Nodes[]).map(plain).join(''):'';
}

class Renderer{
 readonly warnings:string[]=[];
 readonly headings:Heading[]=[];
 private slugger=new GithubSlugger();
 private defs=new Map<string,M.Definition>();
 constructor(private opts:RenderOptions){}

 root(tree:M.Root):CapturedNode[]{
  for(const d of tree.children)if(d.type==='definition')this.defs.set(d.identifier,d);
  return wrapGroups(this.groups(tree.children),false);
 }
 private groups(nodes:M.RootContent[]):CapturedNode[][]{return nodes.map(n=>this.block(n));}
 /** 지시문 토크나이저가 ':' 앞뒤로 나눈 인접 텍스트 노드를 하나로 합친다. */
 private inline(nodes:M.PhrasingContent[]|M.Nodes[]):CapturedNode[]{
  const out:CapturedNode[]=[];
  for(const n of (nodes as M.Nodes[]).flatMap(x=>this.phrase(x))){
   const last=out.length-1;
   if(typeof n==='string'&&typeof out[last]==='string')out[last]=(out[last] as string)+n;else out.push(n);
  }
  return out;
 }

 private url(raw:string,kind:'link'|'image'):string|undefined{
  const v=raw.trim();
  if((kind==='link'?SAFE_LINK:SAFE_IMAGE).test(v))return v;
  this.warnings.push(`허용되지 않은 ${kind==='link'?'링크':'이미지'} 주소를 제거했습니다: ${v.slice(0,60)}`);
  return undefined;
 }

 private block(n:M.RootContent):CapturedNode[]{
  switch(n.type){
   case 'paragraph':return[el('p',{},this.inline(n.children))];
   case 'heading':{
    const text=plain(n),id=this.slugger.slug(text);
    this.headings.push({depth:n.depth,id,text});
    return[el('h'+n.depth,{id},this.inline(n.children))];
   }
   case 'thematicBreak':return[el('hr')];
   case 'blockquote':return[el('blockquote',{},wrapGroups(this.groups(n.children),true))];
   case 'list':return[el(n.ordered?'ol':'ul',n.ordered&&n.start&&n.start!==1?{start:String(n.start)}:{},wrap(n.children.map(li=>this.listItem(li,n.spread||li.spread)),true))];
   case 'code':return[el('pre',{},[el('code',n.lang?{class:'language-'+n.lang.replace(/[^\w-]/g,'')}:{},[n.value+'\n'])])];
   case 'html':this.warnings.push('HTML 태그는 실행하지 않고 글자로 표시합니다.');return[el('p',{},[n.value])];
   case 'table':return[this.table(n)];
   case 'definition':return[];
   case 'containerDirective':case 'leafDirective':return this.directive(n);
   case 'footnoteDefinition':this.warnings.push('각주는 지원하지 않습니다.');return[];
   default:return this.phrase(n as M.Nodes);
  }
 }
 /** mdast-util-to-hast listItem 규칙: 느슨하지 않은 첫 문단만 줄바꿈 없이 펼치고 마지막이 문단이 아니면 줄바꿈으로 닫는다. */
 private listItem(li:M.ListItem,loose:boolean|null|undefined):El{
  const out:CapturedNode[]=[];
  li.children.forEach((c,i)=>{
   const isP=c.type==='paragraph';
   if(loose||i!==0||!isP)out.push('\n');
   if(isP&&!loose)out.push(...this.inline(c.children));else out.push(...this.block(c));
  });
  const tail=li.children.at(-1);
  if(tail&&(loose||tail.type!=='paragraph'))out.push('\n');
  return el('li',{},out);
 }
 private table(t:M.Table):El{
  const cell=(c:M.TableCell,i:number,tag:'th'|'td')=>{const a=t.align?.[i];return el(tag,a?{align:a}:{},this.inline(c.children));};
  const [head,...body]=t.children;
  // React는 표 요소 안의 공백 텍스트를 렌더링하지 않으므로 원본에도 줄바꿈 노드가 없다.
  const row=(r:M.TableRow,tag:'th'|'td')=>el('tr',{},r.children.map((c,i)=>cell(c,i,tag)));
  const parts:CapturedNode[]=[el('thead',{},[row(head,'th')])];
  if(body.length)parts.push(el('tbody',{},body.map(r=>row(r,'td'))));
  return el('table',{},parts);
 }

 private phrase(n:M.Nodes):CapturedNode[]{
  switch(n.type){
   case 'text':return[n.value];
   case 'strong':return[el('strong',{},this.inline(n.children))];
   case 'emphasis':return[el('em',{},this.inline(n.children))];
   case 'delete':return[el('del',{},this.inline(n.children))];
   case 'inlineCode':return[el('code',{},[n.value])];
   case 'break':return[el('br'),'\n'];
   case 'html':this.warnings.push('HTML 태그는 실행하지 않고 글자로 표시합니다.');return[n.value];
   case 'link':return[this.link(n.url,this.inline(n.children))];
   case 'linkReference':{const d=this.defs.get(n.identifier);return d?[this.link(d.url,this.inline(n.children))]:this.inline(n.children);}
   case 'image':return[this.image(n.url,n.alt??'')];
   case 'imageReference':{const d=this.defs.get(n.identifier);return d?[this.image(d.url,n.alt??'')]:[];}
   case 'textDirective':return this.literalDirective(n);
   case 'footnoteReference':this.warnings.push('각주는 지원하지 않습니다.');return[];
   default:return 'children' in n?this.inline(n.children as M.Nodes[]):[];
  }
 }
 private link(raw:string,children:CapturedNode[]):El{
  const href=this.url(raw,'link');
  if(!href)return el('a',{},children);
  return el('a',/^https?:/i.test(href)?{href,target:'_blank',rel:'noopener noreferrer'}:{href},children);
 }
 private image(raw:string,alt:string):El{
  const src=this.url(raw,'image');
  if(!src)return el('span',{},[]);
  const size=(this.opts.imageSize??assetImageSize)(src);
  const attrs:Record<string,string>=size
   ?{alt,loading:'lazy',width:String(size.width),height:String(size.height),decoding:'async','data-nimg':'1',class:'',style:'color:transparent',sizes:'(max-width: 900px) 100vw, 900px',src}
   :{alt,loading:'lazy',decoding:'async',class:'',src};
  return el('span',{class:'mdx-img-skeleton'},[el('img',attrs)]);
 }

 private attr(d:Directive,name:string):string{return (d.attributes?.[name]??'').trim();}
 private directive(d:ContainerDirective|LeafDirective):CapturedNode[]{
  const href=()=>this.url(this.attr(d,'href'),'link');
  switch(d.name){
   case 'mate-promo':return[matePromo()];
   case 'event-cta':{
    const h=href();if(!h)return[];
    const label=this.attr(d,'label');
    const note=d.type==='containerDirective'?d.children.flatMap(c=>c.type==='paragraph'?this.inline(c.children):[]):[];
    const box=eventCta(h,label,this.attr(d,'aria'),note);
    return this.attr(d,'button')==='true'?[box,ctaButton(h,label)]:[box];
   }
   case 'picture':{const src=this.url(this.attr(d,'src'),'image');return src?[picture(src,this.attr(d,'alt'))]:[];}
   default:this.warnings.push(`지원하지 않는 구성 요소 '${d.name}'를 제외했습니다.`);return[];
  }
 }
 /** `Note:that`처럼 의도하지 않은 인라인 지시문은 원문 그대로 복원한다. */
 private literalDirective(d:TextDirective):CapturedNode[]{
  return[':'+d.name,...(d.children.length?['[',...this.inline(d.children),']']:[])];
 }
}

export function renderMarkdown(markdown:string,opts:RenderOptions={}):RenderResult{
 if(markdown.length>MAX_MARKDOWN)throw new Error(`markdown too large (max ${MAX_MARKDOWN} chars)`);
 const tree=fromMarkdown(markdown,{extensions:[gfm(),directive()],mdastExtensions:[gfmFromMarkdown(),directiveFromMarkdown()]});
 const r=new Renderer(opts);
 const nodes=r.root(tree);
 return{nodes,headings:r.headings,warnings:[...new Set(r.warnings)],text:plain(tree)};
}
