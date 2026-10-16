import { getCapturedPage } from '@/lib/pages';
import PageExperience from '@/components/PageExperience';
import PageAnnouncements from '@/components/content/PageAnnouncements';
import {currentUser} from '@/server/current-user';
import {publicChrome} from '@/server/content/public-chrome';
import {getProfile} from '@/server/profiles';
import {database} from '@/server/database';
import {liveRanking} from '@/server/ranking/ranking';
import {buildHomePage} from '@/components/home/home-page';
// 관리자가 올린 공지를 바로 반영하도록 요청마다 렌더링한다.
export const dynamic='force-dynamic';
export default async function Home(){const data=await getCapturedPage('/'),viewer=await currentUser();return data?<><PageExperience data={publicChrome(buildHomePage(data,liveRanking(database(),{period:'all',pageSize:10},null)),viewer?getProfile(database(),viewer.id).nickname:null)}/><PageAnnouncements path="/"/></>:null}
