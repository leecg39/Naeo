import type { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { getCapturedPage } from '@/lib/pages';
import PageExperience from '@/components/PageExperience';
import { pageUser,adminPageUser } from '@/server/current-user';
type Props={params:Promise<{segments:string[]}>};
export async function generateMetadata({params}:Props):Promise<Metadata>{const path='/'+(await params).segments.join('/');const data=await getCapturedPage(path);return{title:data?.title.replace(/(?: \| NAEO)+$/,'')||'NAEO',robots:{index:false,follow:false}}}
export default async function Page({params}:Props){
 const path='/'+(await params).segments.join('/');
 if(path==='/dashboard'||path.startsWith('/dashboard/'))await pageUser(path);
 if(path.startsWith('/updates/'))permanentRedirect('/updates?focus='+encodeURIComponent(path.slice(9)));
 if(path==='/admin'||path.startsWith('/admin/')){await adminPageUser(path);notFound();}
 if(path.startsWith('/social/banner-preview'))redirect('/');
 if(path==='/auth/google')redirect('/login?provider=google&demo=1');
 const data=await getCapturedPage(path);
 if(data)return <PageExperience data={data}/>;
 if(path.startsWith('/dashboard/events/')){const event=await getCapturedPage('/event/'+path.split('/').at(-1));if(event)return <PageExperience data={{...event,path}}/>;redirect('/dashboard/events')}
 if(/^\/p\/[^/]+\/images$/.test(path)){const images=await getCapturedPage('/images');if(images)return <PageExperience data={{...images,path}}/>}
 notFound();
}
