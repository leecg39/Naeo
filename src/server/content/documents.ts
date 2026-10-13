import type {Database} from '../database';

export type DocumentStatus='draft'|'published';
export type SiteDocument={
 id:string;path:string;title:string;effectiveLabel:string;body:string;closingNote:string;status:DocumentStatus;
 position:number;version:number;createdAt:number;updatedAt:number;
};
export type DocumentSection={heading:string;text:string};

type Row={id:string;path:string;title:string;effective_label:string;body:string;closing_note:string;status:DocumentStatus;position:number;version:number;created_at:number;updated_at:number};
export type DocumentRow=Row;
export const DOCUMENT_SELECT='SELECT id,path,title,effective_label,body,closing_note,status,position,version,created_at,updated_at FROM site_documents';
/** 시드로 들어온 정책 문서 경로. 삭제·비공개 뒤에도 캡처 화면으로 되돌아가지 않고 404가 된다. */
export const SEEDED_DOCUMENT_PATHS:readonly string[]=['/terms','/privacy','/privacy/extension','/refund'];

export const toDocument=(r:Row):SiteDocument=>({
 id:r.id,path:r.path,title:r.title,effectiveLabel:r.effective_label,body:r.body,closingNote:r.closing_note,status:r.status,
 position:r.position,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at
});

/**
 * "## 소제목" 줄로 절을 나눈다. 절 사이 빈 줄 하나는 구분자로 보고, 나머지 줄바꿈은 본문에 남긴다
 * (원본 화면은 white-space:pre-line). 첫 소제목 앞의 글은 머리말이다.
 */
export function parseSections(body:string):{preface:string;sections:DocumentSection[]}{
 const heading=/^## (.*)$/gm;
 const marks=[...body.matchAll(heading)];
 const strip=(s:string)=>s.endsWith('\n\n')?s.slice(0,-2):s.endsWith('\n')?s.slice(0,-1):s;
 const preface=strip(body.slice(0,marks[0]?.index??body.length)).trim();
 const sections=marks.map((m,i)=>{
  const start=m.index+m[0].length+1;
  const end=marks[i+1]?.index??body.length;
  return{heading:m[1].trim(),text:start>end?'':strip(body.slice(start,end))};
 });
 return{preface,sections};
}

export function getPublishedDocument(db:Database,path:string):SiteDocument|null{
 const r=db.prepare(`${DOCUMENT_SELECT} WHERE path=? AND status='published'`).get(path) as Row|undefined;
 return r?toDocument(r):null;
}

/** published: 공개 화면, hidden: 문서 경로지만 공개본 없음(404), none: 문서가 맡지 않는 경로. */
export function documentRouteState(db:Database,path:string):'published'|'hidden'|'none'{
 const r=db.prepare('SELECT status FROM site_documents WHERE path=?').get(path) as {status:DocumentStatus}|undefined;
 if(r)return r.status==='published'?'published':'hidden';
 return SEEDED_DOCUMENT_PATHS.includes(path)?'hidden':'none';
}
