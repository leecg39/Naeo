import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {parseRss,type RssFeed} from './rss-parse';
export {parseRss} from './rss-parse';

export const MAX_RSS_BYTES=2*1024*1024;
const TIMEOUT_MS=10_000;
export type FetchLike=(url:string,init?:RequestInit)=>Promise<Response>;
/** 수집 실패. retryable이면 작업 큐가 나중에 다시 시도한다. */
export class CollectError extends Error{
 constructor(public code:string,message:string,public retryable:boolean){super(message);}
}

/** RSS 호스트는 운영에서 네이버만 허용한다. NAEO_RSS_BASE는 격리 테스트용으로 루프백 http만 받는다. */
function rssBase():string{
 const override=process.env.NAEO_RSS_BASE;
 if(!override)return'https://rss.blog.naver.com';
 try{
  const u=new URL(override);
  if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.protocol!=='http:')return'https://rss.blog.naver.com';
  return u.origin;
 }catch{return'https://rss.blog.naver.com';}
}
/** 요청 주소는 고정 호스트 + 검증된 블로그 ID로만 만든다(사용자 입력 URL을 요청하지 않아 SSRF 차단). */
export function rssUrl(naverId:string):string{
 if(!/^[a-z0-9][a-z0-9_-]{1,49}$/i.test(naverId))throw new CollectError('INVALID_BLOG_ID','블로그 ID 형식이 올바르지 않습니다.',false);
 return`${rssBase()}/${naverId}.xml`;
}

async function readLimited(res:Response):Promise<string>{
 const reader=res.body?.getReader();
 if(!reader)return'';
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){
  const {done,value}=await reader.read();
  if(done)break;
  size+=value.byteLength;
  if(size>MAX_RSS_BYTES){await reader.cancel();throw new CollectError('RSS_TOO_LARGE','RSS 응답이 너무 큽니다.',false);}
  chunks.push(value);
 }
 return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

function statusError(status:number):CollectError{
 if(status===404||status===410)return new CollectError('BLOG_NOT_FOUND','네이버에서 블로그를 찾을 수 없습니다.',false);
 if(status>=300&&status<400)return new CollectError('FETCH_FAILED','RSS 주소가 다른 곳으로 이동해 수집하지 않았습니다.',false);
 if(status===429||status>=500)return new CollectError('FETCH_FAILED',`네이버 RSS 응답 오류(${status})입니다. 잠시 후 다시 시도합니다.`,true);
 return new CollectError('FETCH_FAILED',`네이버 RSS 응답 오류(${status})입니다.`,false);
}

export async function fetchRss(naverId:string,fetchImpl:FetchLike=fetch):Promise<RssFeed>{
 const url=rssUrl(naverId);
 let res:Response;
 try{
  res=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(TIMEOUT_MS),headers:{Accept:'application/rss+xml, application/xml, text/xml'}});
 }catch{
  throw new CollectError('FETCH_FAILED','네이버 RSS에 연결하지 못했습니다. 잠시 후 다시 시도합니다.',true);
 }
 if(res.status!==200)throw statusError(res.status);
 const feed=parseRss(await readLimited(res),naverId);
 if(!feed.title&&feed.items.length===0)throw new CollectError('BLOG_NOT_FOUND','네이버에서 블로그를 찾을 수 없거나 공개 글이 없습니다.',false);
 return feed;
}

export type CollectSummary={fetched:number;inserted:number;updated:number;blogTitle:string};

/** RSS를 받아 게시물을 블로그·글 번호 기준으로 넣거나 갱신한다(출처 주소·수집 시각 보존, 빠진 글은 유지). */
export async function collectBlog(db:Database,blogId:string,fetchImpl:FetchLike=fetch,now=Date.now()):Promise<CollectSummary>{
 const blog=db.prepare('SELECT naver_id FROM blogs WHERE id=?').get(blogId) as {naver_id:string}|undefined;
 if(!blog)throw new CollectError('BLOG_NOT_FOUND','블로그가 삭제되었습니다.',false);
 const feed=await fetchRss(blog.naver_id,fetchImpl);
 return transaction(db,()=>{
  let inserted=0,updated=0;
  const exists=db.prepare('SELECT 1 FROM blog_posts WHERE blog_id=? AND external_id=?');
  const upsert=db.prepare(`INSERT INTO blog_posts(id,blog_id,external_id,url,title,excerpt,category,tags_json,published_at,collected_at) VALUES(?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(blog_id,external_id) DO UPDATE SET url=excluded.url,title=excluded.title,excerpt=excluded.excerpt,category=excluded.category,tags_json=excluded.tags_json,published_at=excluded.published_at,collected_at=excluded.collected_at`);
  for(const it of feed.items){
   if(exists.get(blogId,it.externalId))updated++;else inserted++;
   upsert.run(randomUUID(),blogId,it.externalId,it.url,it.title,it.excerpt,it.category,JSON.stringify(it.tags),it.publishedAt,now);
  }
  return{fetched:feed.items.length,inserted,updated,blogTitle:feed.title};
 });
}
