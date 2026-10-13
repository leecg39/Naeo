import type {CapturedNode} from '../../types/site';
import type {Database} from '../database';
import {renderMarkdown} from '../content/markdown';
import {ownedDraft} from './drafts';

/** 내보내기 HTML에 허용하는 태그·속성(나머지 태그는 글자만 남기고, 속성은 버린다). */
const TAGS=new Set(['h1','h2','h3','h4','h5','h6','p','strong','em','del','code','pre','blockquote','ul','ol','li','a','img','table','thead','tbody','tr','th','td','hr','br']);
const ATTRS=new Set(['href','src','alt','title']);
const VOID=new Set(['img','hr','br']);
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);

/** 안전한 렌더러가 만든 노드를 HTML 문자열로 바꾼다. 모든 글자·속성값을 이스케이프한다. */
export function nodesToHtml(nodes:CapturedNode[]):string{
 return nodes.map(n=>{
  if(typeof n==='string')return esc(n);
  const inner=nodesToHtml(n.children);
  if(!TAGS.has(n.tag))return inner;
  const attrs=Object.entries(n.attrs).filter(([k,v])=>ATTRS.has(k)&&!/^\s*(javascript|data|vbscript):/i.test(v)).map(([k,v])=>` ${k}="${esc(v)}"`).join('');
  return VOID.has(n.tag)?`<${n.tag}${attrs}>`:`<${n.tag}${attrs}>${inner}</${n.tag}>`;
 }).join('');
}

export type ExportFormat='html'|'markdown'|'text';
/** 네이버 블로그 붙여넣기용 내보내기(HTML·마크다운·순수 텍스트). 본인 초안만. */
export function exportDraft(db:Database,ownerId:string,id:string,format:ExportFormat){
 const d=ownedDraft(db,ownerId,id);
 const rendered=renderMarkdown(d.body.slice(0,100000));
 if(format==='html')return{contentType:'text/html; charset=utf-8',body:`<h1>${esc(d.title)}</h1>\n${nodesToHtml(rendered.nodes)}`,filename:'naeo-draft.html'};
 if(format==='markdown')return{contentType:'text/markdown; charset=utf-8',body:`# ${d.title}\n\n${d.body}\n`,filename:'naeo-draft.md'};
 return{contentType:'text/plain; charset=utf-8',body:`${d.title}\n\n${rendered.text.trim()}\n`,filename:'naeo-draft.txt'};
}
