import {adminPageUser} from '@/server/current-user';
import {contentDatabase} from '@/server/content/public-pages';
import {listRewards} from '@/server/events/rewards';
import AdminShell from '@/components/admin/AdminShell';
import RewardsManager from '@/components/admin/RewardsManager';
export const dynamic='force-dynamic';
export default async function AdminRewardsPage(){
 const user=await adminPageUser('/admin/rewards');
 return <AdminShell title="보상" path="/admin/rewards"><RewardsManager initial={listRewards(contentDatabase(),user.id,{pageSize:100})}/></AdminShell>;
}
