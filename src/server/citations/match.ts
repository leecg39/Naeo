import type {SearchEvidence} from './provider';

const BLOG_ID=/^[a-z0-9][a-z0-9_-]{1,49}$/i,LOG_NO=/^\d{1,30}$/;
/** 네이버 블로그 주소에서 블로그 ID와 글 번호를 꺼낸다(모바일·PostView 형식 포함). 다른 호스트는 null. */
export function naverPostRef(link:string):{naverId:string;logNo:string|null}|null{
 let u:URL;
 try{u=new URL(link);}catch{return null;}
 if(u.protocol!=='https:'&&u.protocol!=='http:')return null;
 const host=u.hostname.toLowerCase();
 if(host!=='blog.naver.com'&&host!=='m.blog.naver.com')return null;
 const [first,second]=u.pathname.split('/').filter(Boolean);
 if(/^Post(View|List)\.(naver|nhn)$/i.test(first??'')){
  const id=u.searchParams.get('blogId')??'',no=u.searchParams.get('logNo')??'';
  return BLOG_ID.test(id)?{naverId:id.toLowerCase(),logNo:LOG_NO.test(no)?no:null}:null;
 }
 if(!first||!BLOG_ID.test(first))return null;
 return{naverId:first.toLowerCase(),logNo:second&&LOG_NO.test(second)?second:null};
}

export type CitationMatch={briefing:boolean;exposed:boolean;textRank:number|null;imageRank:number|null;exposure:{section:string;position:number}|null};
/**
 * 새 규칙(원본 판정식 미확인): AI 추천은 브리핑 본문 출처·이미지 출처에 내 블로그 글이 있으면 인정하고,
 * 통합검색 노출은 이 글(같은 글 번호)이 통합검색 일반 결과에 있을 때만 인정한다.
 */
export function matchCitation(evidence:SearchEvidence,naverId:string,logNo:string):CitationMatch{
 const id=naverId.toLowerCase();
 const mine=(link:string)=>naverPostRef(link)?.naverId===id;
 const text=evidence.briefing?.references.filter(r=>mine(r.link)).sort((a,b)=>a.index-b.index)[0];
 const image=evidence.briefing?.media.filter(m=>mine(m.link)).sort((a,b)=>a.position-b.position)[0];
 const exposure=evidence.links.find(l=>{const r=naverPostRef(l.link);return r?.naverId===id&&r.logNo===logNo;});
 return{briefing:!!evidence.briefing,exposed:!!exposure,textRank:text?.index??null,imageRank:image?.position??null,exposure:exposure?{section:exposure.section,position:exposure.position}:null};
}
