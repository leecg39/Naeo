import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { getCapturedPage } from '@/lib/pages';
import PageExperience from '@/components/PageExperience';
import { pageUser,adminPageUser } from '@/server/current-user';
import { cache } from 'react';
import { resolveBlogPage } from '@/server/content/public-pages';
type Props={params:Promise<{segments:string[]}>};
// 블로그 글은 DB에서 읽으므로 요청마다 렌더링한다(관리자 수정·비공개 즉시 반영).
export const dynamic='force-dynamic';
const blogPage=cache(resolveBlogPage);
export async function generateMetadata({params}:Props):Promise<Metadata>{const path='/'+(await params).segments.join('/');const data=(await blogPage(path))??await getCapturedPage(path);return{title:data?.title.replace(/(?: \| NAEO)+$/,'')||'NAEO',robots:{index:false,follow:false}}}
export default async function Page({params}:Props){
 const path='/'+(await params).segments.join('/');
 if(path==='/dashboard'||path.startsWith('/dashboard/'))await pageUser(path);
 if(path.startsWith('/updates/'))permanentRedirect('/updates?focus='+encodeURIComponent(path.slice(9)));
 if(path==='/admin'||path.startsWith('/admin/')){await adminPageUser(path);notFound();}
 if(path.startsWith('/social/banner-preview'))redirect('/');
 if(path==='/auth/google')redirect('/login?provider=google&demo=1');
 const blog=await blogPage(path);
 if(blog===null)notFound();
 if(blog)return <PageExperience data={blog}/>;
 const data=await getCapturedPage(path);
 if(data)return <PageExperience data={data}/>;
 if(path.startsWith('/dashboard/events/')){const event=await getCapturedPage('/event/'+path.split('/').at(-1));if(event)return <PageExperience data={{...event,path}}/>;redirect('/dashboard/events')}
 if(/^\/p\/[^/]+\/images$/.test(path)){const images=await getCapturedPage('/images');if(images)return <PageExperience data={{...images,path}}/>}
 notFound();
}
