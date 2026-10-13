import {adminPageUser} from '@/server/current-user';
import {contentDatabase} from '@/server/content/public-pages';
import {listAdminUpdates} from '@/server/content/admin-updates';
import AdminShell from '@/components/admin/AdminShell';
import UpdatesManager from '@/components/admin/UpdatesManager';
export const dynamic='force-dynamic';
export default async function AdminUpdatesPage(){
 const user=await adminPageUser('/admin/updates');
 return <AdminShell title="업데이트 소식 관리" path="/admin/updates"><UpdatesManager initial={listAdminUpdates(contentDatabase(),user.id,{})}/></AdminShell>;
}
