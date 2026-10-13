import type {MetadataRoute} from 'next';
import {appOrigin} from '@/server/http';
import {robotsRules} from '@/server/content/seo';
// 환경 변수로 색인 허용 여부를 바꿀 수 있도록 요청마다 만든다.
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots{
 return robotsRules(appOrigin(),process.env.NAEO_ALLOW_INDEXING==='1');
}
