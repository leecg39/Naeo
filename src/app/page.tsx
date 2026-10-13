import { getCapturedPage } from '@/lib/pages';
import PageExperience from '@/components/PageExperience';
import AnnouncementBar from '@/components/content/AnnouncementBar';
import { contentDatabase } from '@/server/content/public-pages';
import { activeAnnouncement } from '@/server/content/announcements';
// 관리자가 올린 공지를 바로 반영하도록 요청마다 렌더링한다.
export const dynamic='force-dynamic';
export default async function Home(){const data=await getCapturedPage('/');const notice=activeAnnouncement(contentDatabase(),'/');return data?<><PageExperience data={data}/>{notice&&<AnnouncementBar announcement={notice}/>}</>:null}
