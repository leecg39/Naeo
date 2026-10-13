import {adminPageUser} from '@/server/current-user';
import {database} from '@/server/database';
import {listTemplates} from '@/server/inquiries/templates';
import AdminShell from '@/components/admin/AdminShell';
import TemplatesManager from '@/components/admin/TemplatesManager';
export const dynamic='force-dynamic';
export default async function AdminInquiryTemplatesPage(){
 const user=await adminPageUser('/admin/inquiries/templates');
 return <AdminShell title="답변 템플릿" path="/admin/inquiries/templates"><TemplatesManager initial={listTemplates(database(),user.id)}/></AdminShell>;
}
