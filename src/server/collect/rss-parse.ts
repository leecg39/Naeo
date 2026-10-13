/** 네이버 블로그 RSS 2.0 파서. 외부 라이브러리 없이 크기 제한된 입력만 다룬다(단순 패턴만 사용). */
export type RssItem={externalId:string;url:string;title:string;excerpt:string;category:string;tags:string[];publishedAt:number|null};
export type RssFeed={title:string;items:RssItem[]};

const ENTITIES:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
export function decodeEntities(s:string):string{
 return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,(m,e:string)=>{
  if(e[0]==='#'){const code=e[1]==='x'||e[1]==='X'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return Number.isFinite(code)&&code>0&&code<=0x10ffff?String.fromCodePoint(code):m;}
  return ENTITIES[e.toLowerCase()]??m;
 });
}
/** CDATA면 그대로 꺼내고, 아니면 XML 엔티티를 푼다. */
function text(raw:string|undefined):string{
 if(raw===undefined)return'';
 const cdata=/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
 return cdata?cdata[1]:decodeEntities(raw);
}
function tag(block:string,name:string):string|undefined{
 const m=new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block);
 return m?.[1];
}
const collapse=(s:string)=>s.replace(/\s+/g,' ').trim();
/** HTML을 지운 순수 텍스트(엔티티 해제, 공백 정리). */
export const plainText=(html:string)=>collapse(decodeEntities(html.replace(/<[^>]*>/g,' ')));

/** 글 주소가 이 블로그의 글(blog.naver.com/{id}/{숫자})일 때만 정규 주소와 글 번호를 돌려준다. */
export function canonicalPost(link:string,naverId:string):{url:string;externalId:string}|null{
 let u:URL;
 try{u=new URL(link.trim());}catch{return null;}
 if(u.protocol!=='https:'&&u.protocol!=='http:')return null;
 if(u.hostname!=='blog.naver.com'&&u.hostname!=='m.blog.naver.com')return null;
 const [, id, logNo]=u.pathname.split('/');
 if(!id||id.toLowerCase()!==naverId.toLowerCase()||!/^\d{1,30}$/.test(logNo??''))return null;
 return{url:`https://blog.naver.com/${naverId}/${logNo}`,externalId:logNo};
}

function parseItem(block:string,naverId:string):RssItem|null{
 const post=canonicalPost(text(tag(block,'link')),naverId)??canonicalPost(text(tag(block,'guid')),naverId);
 if(!post)return null;
 const date=Date.parse(text(tag(block,'pubDate')));
 const tags=text(tag(block,'tag')).split(',').map(t=>collapse(t).slice(0,50)).filter(Boolean).slice(0,30);
 return{...post,title:collapse(text(tag(block,'title'))).slice(0,300),excerpt:plainText(text(tag(block,'description'))).slice(0,2000),
  category:collapse(text(tag(block,'category'))).slice(0,100),tags,publishedAt:Number.isNaN(date)?null:date};
}

export function parseRss(xml:string,naverId:string):RssFeed{
 const head=xml.split(/<item[\s>]/)[0]??'';
 const items=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)].map(m=>parseItem(m[1],naverId)).filter((i):i is RssItem=>i!==null);
 const unique=items.filter((it,i)=>items.findIndex(x=>x.externalId===it.externalId)===i);
 return{title:collapse(text(tag(head,'title'))).slice(0,200),items:unique};
}
