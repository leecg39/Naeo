import {adminPageUser} from '@/server/current-user';
import {database} from '@/server/database';
import {listAdminKeywords} from '@/server/keywords/admin-keywords';
import AdminShell from '@/components/admin/AdminShell';
import KeywordsManager from '@/components/admin/KeywordsManager';
export const dynamic='force-dynamic';
export default async function AdminKeywordsPage(){
 const user=await adminPageUser('/admin/keywords');
 return <AdminShell title="키워드 관리" path="/admin/keywords"><KeywordsManager initial={listAdminKeywords(database(),user.id,{})}/></AdminShell>;
}
