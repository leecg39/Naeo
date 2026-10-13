import {adminPageUser} from '@/server/current-user';
import {contentDatabase} from '@/server/content/public-pages';
import {listAdminDocuments} from '@/server/content/admin-documents';
import AdminShell from '@/components/admin/AdminShell';
import DocumentsManager from '@/components/admin/DocumentsManager';
export const dynamic='force-dynamic';
export default async function AdminPagesPage(){
 const user=await adminPageUser('/admin/pages');
 return <AdminShell title="정책 문서 관리" path="/admin/pages"><DocumentsManager initial={listAdminDocuments(contentDatabase(),user.id,{pageSize:100})}/></AdminShell>;
}
