import { getCapturedPage } from '@/lib/pages';
import PageExperience from '@/components/PageExperience';
import PageAnnouncements from '@/components/content/PageAnnouncements';
import {currentUser} from '@/server/current-user';
import {publicChrome} from '@/server/content/public-chrome';
import {getProfile} from '@/server/profiles';
import {database} from '@/server/database';
// 관리자가 올린 공지를 바로 반영하도록 요청마다 렌더링한다.
export const dynamic='force-dynamic';
export default async function Home(){const data=await getCapturedPage('/'),viewer=await currentUser();return data?<><PageExperience data={publicChrome(data,viewer?getProfile(database(),viewer.id).nickname:null)}/><PageAnnouncements path="/"/></>:null}
