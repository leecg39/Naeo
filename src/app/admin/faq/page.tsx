import {adminPageUser} from '@/server/current-user';
import {contentDatabase} from '@/server/content/public-pages';
import {listAdminFaq} from '@/server/content/admin-faq';
import AdminShell from '@/components/admin/AdminShell';
import FaqManager from '@/components/admin/FaqManager';
export const dynamic='force-dynamic';
export default async function AdminFaqPage(){
 const user=await adminPageUser('/admin/faq');
 return <AdminShell title="FAQ 관리" path="/admin/faq"><FaqManager initial={listAdminFaq(contentDatabase(),user.id,{pageSize:100})}/></AdminShell>;
}
