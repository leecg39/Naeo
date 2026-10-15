import { getCapturedPage } from '@/lib/pages';
import PageExperience from '@/components/PageExperience';
import PageAnnouncements from '@/components/content/PageAnnouncements';
// 관리자가 올린 공지를 바로 반영하도록 요청마다 렌더링한다.
export const dynamic='force-dynamic';
export default async function Home(){const data=await getCapturedPage('/');return data?<><PageExperience data={data}/><PageAnnouncements path="/"/></>:null}
