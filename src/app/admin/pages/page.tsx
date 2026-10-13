import {adminPageUser} from '@/server/current-user';
import {pageSettingsDatabase} from '@/server/content/public-pages';
import {listAdminDocuments} from '@/server/content/admin-documents';
import {listPageSettings} from '@/server/content/admin-page-settings';
import AdminShell from '@/components/admin/AdminShell';
import DocumentsManager from '@/components/admin/DocumentsManager';
import PageSettingsManager from '@/components/admin/PageSettingsManager';
export const dynamic='force-dynamic';
export default async function AdminPagesPage(){
 const user=await adminPageUser('/admin/pages');
 const db=await pageSettingsDatabase();
 return <AdminShell title="페이지·정책 문서 관리" path="/admin/pages">
  <DocumentsManager initial={listAdminDocuments(db,user.id,{pageSize:100})}/>
  <div style={{marginTop:24}}><PageSettingsManager initial={listPageSettings(db,user.id)}/></div>
 </AdminShell>;
}
