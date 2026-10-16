import {z} from 'zod';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';

export type KeywordSource='member'|'tag'|'title';
export type PostKeyword={keyword:string;source:KeywordSource;version:number};
const clean=(s:string)=>s.replace(/\p{Extended_Pictographic}|\p{Cc}/gu,' ').replace(/\s+/g,' ').trim();
const cut=(s:string,max:number)=>[...s].slice(0,max).join('').trim();
export const keywordInput=z.object({keyword:z.string().transform(clean).pipe(z.string().min(2).max(60)),version:z.number().int().min(0)}).strict();
const versionInput=z.object({version:z.number().int().min(1)}).strict();

/**
 * 새 규칙(원본은 AI로 대표 키워드를 뽑지만 방식 미확인): 작성자가 단 첫 태그를 쓰고,
 * 태그가 없으면 제목의 대괄호·괄호를 지운 첫 구절을 30자 안에서 단어 단위로 자른다. 회원이 고친 값이 항상 우선한다.
 */
export function autoKeyword(title:string,tags:string[]):{keyword:string;source:'tag'|'title'}|null{
 const tag=tags.map(t=>clean(t.replace(/^#+/,''))).find(t=>[...t].length>=2);
 if(tag)return{keyword:cut(tag,60),source:'tag'};
 const clause=clean(title.replace(/\[[^\]]*\]|【[^】]*】|\([^)]*\)|<[^>]*>/g,' ')).split(/[,.!?|~·:;/]|\s[-–—]\s/)[0]??'';
 let keyword='';
 for(const word of clean(clause).split(' ').filter(Boolean)){const next=keyword?`${keyword} ${word}`:word;if([...next].length>30)break;keyword=next;}
 if(!keyword)keyword=cut(clean(clause)||clean(title),30);
 return [...keyword].length>=2?{keyword,source:'title'}:null;
}

type PostRow={id:string;title:string;tags_json:string};
export function effectiveKeyword(db:Database,ownerId:string,post:PostRow):PostKeyword|null{
 const own=db.prepare('SELECT keyword,version FROM post_keywords WHERE post_id=? AND owner_id=?').get(post.id,ownerId) as {keyword:string;version:number}|undefined;
 if(own)return{keyword:own.keyword,source:'member',version:own.version};
 const auto=autoKeyword(post.title,JSON.parse(post.tags_json) as string[]);
 return auto?{...auto,version:0}:null;
}

function ownedPost(db:Database,ownerId:string,postId:string):PostRow{
 const p=/^[a-f0-9-]{36}$/.test(postId)?db.prepare('SELECT p.id,p.title,p.tags_json FROM blog_posts p JOIN blogs b ON b.id=p.blog_id WHERE p.id=? AND b.owner_id=?').get(postId,ownerId) as PostRow|undefined:undefined;
 if(!p)throw new AppError(404,'POST_NOT_FOUND','글을 찾을 수 없습니다.');
 return p;
}
/** 대표 키워드 직접 지정: version 0은 새로 지정, 그 외에는 같은 버전일 때만 수정한다. */
export function setPostKeyword(db:Database,ownerId:string,postId:string,input:unknown,now=Date.now()):PostKeyword{
 const v=keywordInput.parse(input);
 return transaction(db,()=>{
  const post=ownedPost(db,ownerId,postId);
  const current=db.prepare('SELECT version FROM post_keywords WHERE post_id=?').get(post.id) as {version:number}|undefined;
  if((current?.version??0)!==v.version)throw new AppError(409,'VERSION_CONFLICT','대표 키워드가 변경되었습니다. 새로고침해주세요.');
  if(current)db.prepare('UPDATE post_keywords SET keyword=?,version=version+1,updated_at=? WHERE post_id=?').run(v.keyword,now,post.id);
  else db.prepare('INSERT INTO post_keywords(post_id,owner_id,keyword,updated_at) VALUES(?,?,?,?)').run(post.id,ownerId,v.keyword,now);
  return effectiveKeyword(db,ownerId,post)!;
 });
}
/** 직접 지정을 지우면 자동 규칙(태그·제목)으로 돌아간다. */
export function removePostKeyword(db:Database,ownerId:string,postId:string,input:unknown){
 const {version}=versionInput.parse(input);
 return transaction(db,()=>{
  const post=ownedPost(db,ownerId,postId);
  const removed=db.prepare('DELETE FROM post_keywords WHERE post_id=? AND owner_id=? AND version=?').run(post.id,ownerId,version);
  if(!removed.changes)throw new AppError(409,'VERSION_CONFLICT','대표 키워드가 변경되었거나 이미 자동 키워드입니다. 새로고침해주세요.');
  return effectiveKeyword(db,ownerId,post);
 });
}
