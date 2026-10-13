import type {CapturedNode} from '../../src/types/site';

type El=Exclude<CapturedNode,string>;
const isEl=(n:CapturedNode):n is El=>typeof n!=='string';
const cls=(n:El)=>n.attrs.class??'';
const kids=(n:El)=>n.children.filter(isEl);

/** 캡처 본문 텍스트를 마크다운 문법으로 오해되지 않게 이스케이프한다. */
export function escapeText(s:string,inTable=false):string{
 let out=s.replace(/[\\`*_[\]<~]/g,m=>'\\'+m).replace(/:(?=[A-Za-z])/g,'\\:');
 if(inTable)out=out.replace(/\|/g,'\\|');
 return out;
}
function escapeLineStart(s:string):string{
 return s.split('\n').map(l=>l.replace(/^(\s*)([#>+-]|\d+[.)])(?=\s|$)/,'$1\\$2').replace(/^(\s*)(={3,}|-{3,})\s*$/,'$1\\$2')).join('\n');
}
const attr=(v:string)=>'"'+v.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';

function inline(nodes:CapturedNode[],inTable=false):string{
 return nodes.map(n=>{
  if(!isEl(n))return escapeText(n,inTable);
  const inner=()=>inline(n.children,inTable);
  switch(n.tag){
   case 'strong':return `**${inner()}**`;
   case 'em':return `*${inner()}*`;
   case 'del':return `~~${inner()}~~`;
   case 'code':{const t=n.children.join('');const f=t.includes('`')?'``':'`';return f+(t.startsWith('`')?' ':'')+t+(t.endsWith('`')?' ':'')+f;}
   case 'a':return `[${inner()}](${n.attrs.href??''})`;
   case 'br':return '\\\n';
   case 'span':{
    if(cls(n).includes('mdx-img-skeleton')){const img=kids(n)[0];return `![${escapeText(img.attrs.alt??'')}](${img.attrs.src})`;}
    return inner();
   }
   case 'img':return `![${escapeText(n.attrs.alt??'')}](${n.attrs.src})`;
   default:throw new Error(`unsupported inline <${n.tag}>`);
  }
 }).join('');
}

function table(t:El):string{
 const rows:string[][]=[];
 for(const part of kids(t))for(const tr of kids(part))rows.push(kids(tr).map(c=>inline(c.children,true).replace(/\n/g,' ')));
 const width=Math.max(...rows.map(r=>r.length));
 const line=(r:string[])=>'| '+Array.from({length:width},(_,i)=>r[i]??'').join(' | ')+' |';
 const head=kids(kids(t)[0])[0];
 const align=kids(head).map(c=>c.attrs.align==='center'?':---:':c.attrs.align==='right'?'---:':c.attrs.align==='left'?':---':'---');
 return [line(rows[0]),'| '+align.join(' | ')+' |',...rows.slice(1).map(line)].join('\n');
}

function list(n:El,depth:number):string{
 const ordered=n.tag==='ol';let i=Number(n.attrs.start??1);
 const items=kids(n).map(li=>{
  const marker=ordered?`${i++}.`:'-';const pad=' '.repeat(marker.length+1);
  const blocks:string[]=[];let run:CapturedNode[]=[];
  const flush=()=>{if(run.some(x=>!isEl(x)?x.trim():true))blocks.push(escapeLineStart(inline(trimEdges(run))));run=[];};
  for(const c of li.children){
   if(isEl(c)&&['ul','ol','p','blockquote','table','hr'].includes(c.tag)){flush();blocks.push(block(c,depth+1));}
   else run.push(c);
  }
  flush();
  const loose=kids(li).some(c=>c.tag==='p');
  const body=blocks.join(loose?'\n\n':'\n').split('\n').map((l,j)=>j===0||!l?l:pad+l).join('\n');
  return marker+' '+body;
 });
 const loose=kids(n).some(li=>kids(li).some(c=>c.tag==='p'));
 return items.join(loose?'\n\n':'\n');
}
function trimEdges(nodes:CapturedNode[]):CapturedNode[]{
 const out=[...nodes];
 while(out.length&&!isEl(out[0])&&!out[0].trim())out.shift();
 while(out.length&&!isEl(out.at(-1)!)&&!(out.at(-1) as string).trim())out.pop();
 return out;
}

export function block(n:El,depth=0):string{
 const c=cls(n);
 switch(n.tag){
  case 'p':return escapeLineStart(inline(n.children));
  case 'h1':case 'h2':case 'h3':case 'h4':case 'h5':case 'h6':return '#'.repeat(Number(n.tag[1]))+' '+inline(n.children);
  case 'hr':return '---';
  case 'blockquote':return kids(n).map(b=>block(b,depth)).join('\n\n').split('\n').map(l=>l?'> '+l:'>').join('\n');
  case 'ul':case 'ol':return list(n,depth);
  case 'table':return table(n);
  case 'picture':{const img=kids(n).find(k=>k.tag==='img')!;return `::picture{src=${attr(img.attrs.src)} alt=${attr(img.attrs.alt??'')}}`;}
  case 'aside':
   if(c.includes('mui-tha3yc'))return '::mate-promo';
   if(c.includes('mui-bgsx1o'))return eventCta(n,false);
   break;
 }
 throw new Error(`unsupported block <${n.tag} class="${c}">`);
}

function eventCta(n:El,button:boolean):string{
 const [a,p]=kids(n);const label=a.children.filter(x=>!isEl(x)).join('').trim();
 const head=`event-cta{href=${attr(a.attrs.href)} label=${attr(label)} aria=${attr(n.attrs['aria-label']??'')}${button?' button="true"':''}}`;
 return p?`:::${head}\n${inline(p.children)}\n:::`:`::${head}`;
}

/** 원본에서 이벤트 상자 바로 뒤(줄바꿈 없이)에 붙은 모바일 버튼은 상자 지시문의 button 옵션으로 합친다. */
export function toMarkdown(body:El):string{
 const out:string[]=[];const nodes=body.children;
 for(let i=0;i<nodes.length;i++){
  const n=nodes[i];
  if(!isEl(n)){if(n.trim())throw new Error('unexpected top-level text: '+n.slice(0,40));continue;}
  const next=nodes[i+1];
  if(cls(n).includes('mui-bgsx1o')&&next&&isEl(next)&&cls(next).includes('mui-12hyhuy')){out.push(eventCta(n,true));i++;continue;}
  out.push(block(n));
 }
 return out.join('\n\n')+'\n';
}
