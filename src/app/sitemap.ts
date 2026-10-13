import type {MetadataRoute} from 'next';
import {appOrigin} from '@/server/http';
import {pageSettingsDatabase} from '@/server/content/public-pages';
import {sitemapEntries} from '@/server/content/seo';
// 관리자가 공개·비공개를 바꾸면 바로 반영되도록 요청마다 DB를 읽는다.
export const dynamic='force-dynamic';
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
 return sitemapEntries(await pageSettingsDatabase(),appOrigin());
}
