/** CSS 문자열을 최상위 규칙(@media 블록은 통째로) 단위로 나눈다. 문자열·주석 안의 중괄호는 무시한다. */
export function splitTopLevel(css:string):string[]{
 const out:string[]=[];let depth=0,start=0,quote='';
 for(let i=0;i<css.length;i++){
  const ch=css[i];
  if(quote){if(ch==='\\')i++;else if(ch===quote)quote='';continue;}
  if(ch==='"'||ch==="'"){quote=ch;continue;}
  if(ch==='/'&&css[i+1]==='*'){const end=css.indexOf('*/',i+2);i=end<0?css.length:end+1;continue;}
  if(ch==='{')depth++;
  else if(ch==='}'){depth--;if(depth===0){out.push(css.slice(start,i+1).trim());start=i+1;}}
  else if(ch===';'&&depth===0){out.push(css.slice(start,i+1).trim());start=i+1;}
 }
 const tail=css.slice(start).trim();if(tail)out.push(tail);
 return out.filter(Boolean);
}
/** 여러 페이지 CSS를 첫 등장 순서대로 합치되 동일 규칙은 한 번만 남긴다. */
export function mergeCss(sheets:string[]):string{
 const seen=new Set<string>();const out:string[]=[];
 for(const s of sheets)for(const b of splitTopLevel(s))if(!seen.has(b)){seen.add(b);out.push(b);}
 return out.join('\n');
}
