import {appOrigin} from '@/server/http';
import {pageSettingsDatabase} from '@/server/content/public-pages';
import {llmsTxt} from '@/server/content/seo';
export const dynamic='force-dynamic';
/** AI 도구용 공개 콘텐츠 색인. */
export async function GET(){
 return new Response(llmsTxt(await pageSettingsDatabase(),appOrigin()),{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-cache'}});
}
