import {appOrigin} from '@/server/http';
import {contentDatabase} from '@/server/content/public-pages';
import {rssXml} from '@/server/content/seo';
export const dynamic='force-dynamic';
/** 매거진 공개 글 RSS 2.0 피드. */
export function GET(){
 return new Response(rssXml(contentDatabase(),appOrigin()),{headers:{'Content-Type':'application/rss+xml; charset=utf-8','Cache-Control':'no-cache'}});
}
