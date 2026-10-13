import {adminPageUser} from '@/server/current-user';
import {contentDatabase} from '@/server/content/public-pages';
import {listAdminEvents} from '@/server/events/events';
import AdminShell from '@/components/admin/AdminShell';
import EventsManager from '@/components/admin/EventsManager';
export const dynamic='force-dynamic';
export default async function AdminEventsPage(){
 const user=await adminPageUser('/admin/events');
 return <AdminShell title="이벤트 관리" path="/admin/events"><EventsManager initial={listAdminEvents(contentDatabase(),user.id,{pageSize:100})}/></AdminShell>;
}
