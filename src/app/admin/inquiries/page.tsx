import {adminPageUser} from '@/server/current-user';
import {database} from '@/server/database';
import {listAdminInquiries} from '@/server/inquiries/admin-inquiries';
import {listTemplates} from '@/server/inquiries/templates';
import AdminShell from '@/components/admin/AdminShell';
import InquiriesManager from '@/components/admin/InquiriesManager';
export const dynamic='force-dynamic';
export default async function AdminInquiriesPage(){
 const user=await adminPageUser('/admin/inquiries'),db=database();
 return <AdminShell title="문의 관리" path="/admin/inquiries"><InquiriesManager initial={listAdminInquiries(db,user.id,{})} templates={listTemplates(db,user.id)}/></AdminShell>;
}
