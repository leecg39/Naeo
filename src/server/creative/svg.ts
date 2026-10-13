import type {Project,Slide} from './projects';

const esc=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
/** 줄바꿈: 한글은 글자 수 기준(폭 추정)으로 자르고, 사용자가 넣은 줄바꿈은 유지한다. */
export function wrap(text:string,perLine:number,maxLines:number):string[]{
 const out:string[]=[];
 for(const para of text.split(/\r?\n/)){
  let line='';
  for(const word of para.split(/(\s+)/)){
   if([...line+word].length<=perLine){line+=word;continue;}
   if(line.trim())out.push(line.trim());
   line=word.trimStart();
   while([...line].length>perLine){out.push([...line].slice(0,perLine).join(''));line=[...line].slice(perLine).join('');}
  }
  out.push(line.trim());
 }
 const lines=out.filter((l,i)=>l||i<out.length-1);
 return lines.length>maxLines?[...lines.slice(0,maxLines-1),`${lines[maxLines-1].slice(0,Math.max(0,perLine-1))}…`]:lines;
}
function textBlock(lines:string[],x:number,y:number,size:number,fill:string,weight:number){
 if(!lines.length)return'';
 return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" font-family="Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif">${lines.map((l,i)=>`<tspan x="${x}" dy="${i===0?0:Math.round(size*1.35)}">${esc(l)}</tspan>`).join('')}</text>`;
}
/** 슬라이드 한 장을 프로젝트 크기의 SVG로 그린다(미리보기·내보내기 공통, 사용자 글은 모두 이스케이프). */
export function slideSvg(project:Pick<Project,'width'|'height'|'theme'|'kind'>,slide:Pick<Slide,'heading'|'body'|'caption'|'background'>,index:number,total:number):string{
 const {width:w,height:h,theme}=project,pad=Math.round(w*0.08),unit=w/1080;
 const head=Math.round(76*unit),bodySize=Math.round(40*unit),small=Math.round(28*unit);
 const perHead=Math.max(6,Math.floor((w-pad*2)/(head*0.95))),perBody=Math.max(8,Math.floor((w-pad*2)/(bodySize*0.95)));
 const headLines=wrap(slide.heading,perHead,4),bodyLines=wrap(slide.body,perBody,project.kind==='video'?6:12);
 const headY=Math.round(h*0.22),bodyY=headY+headLines.length*Math.round(head*1.35)+Math.round(48*unit);
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  +`<rect width="${w}" height="${h}" fill="${slide.background||theme.background}"/>`
  +`<rect x="${pad}" y="${Math.round(h*0.12)}" width="${Math.round(96*unit)}" height="${Math.round(10*unit)}" rx="${Math.round(5*unit)}" fill="${theme.accent}"/>`
  +textBlock(headLines,pad,headY,head,theme.text,800)
  +textBlock(bodyLines,pad,bodyY,bodySize,theme.text,400)
  +textBlock(slide.caption?[slide.caption]:[],pad,h-pad,small,theme.accent,700)
  +`<text x="${w-pad}" y="${h-pad}" text-anchor="end" font-size="${small}" fill="${theme.text}" opacity="0.6" font-family="sans-serif">${index+1} / ${total}</text>`
  +'</svg>';
}
