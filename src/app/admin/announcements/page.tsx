import {adminPageUser} from '@/server/current-user';
import {contentDatabase} from '@/server/content/public-pages';
import {listAdminAnnouncements} from '@/server/content/admin-announcements';
import AdminShell from '@/components/admin/AdminShell';
import AnnouncementsManager from '@/components/admin/AnnouncementsManager';
export const dynamic='force-dynamic';
function load(userId:string){
 return{initial:listAdminAnnouncements(contentDatabase(),userId,{pageSize:100}),now:Date.now()};
}
export default async function AdminAnnouncementsPage(){
 const user=await adminPageUser('/admin/announcements');
 return <AdminShell title="공지 관리" path="/admin/announcements"><AnnouncementsManager {...load(user.id)}/></AdminShell>;
}
