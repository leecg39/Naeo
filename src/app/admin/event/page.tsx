import {adminPageUser} from '@/server/current-user';
import {contentDatabase} from '@/server/content/public-pages';
import {listAdminEvents} from '@/server/events/events';
import {listEventEntries} from '@/server/events/entries';
import AdminShell from '@/components/admin/AdminShell';
import EntriesReview from '@/components/admin/EntriesReview';
export const dynamic='force-dynamic';
type Props={searchParams:Promise<Record<string,string|string[]|undefined>>};
/** 이벤트 참여 심사. ?slug=로 이벤트를 고르며, 없으면 참여를 받는 첫 이벤트. */
export default async function AdminEventEntriesPage({searchParams}:Props){
 const user=await adminPageUser('/admin/event'),db=contentDatabase();
 const events=listAdminEvents(db,user.id,{pageSize:100}).data.filter(e=>e.acceptsEntries).map(e=>({slug:e.slug,title:e.title}));
 const raw=(await searchParams).slug,wanted=Array.isArray(raw)?raw[0]:raw;
 const slug=events.find(e=>e.slug===wanted)?.slug??events[0]?.slug;
 return <AdminShell title="이벤트 참여 심사" path="/admin/event"><EntriesReview events={events} initial={slug?listEventEntries(db,user.id,slug,{pageSize:100}):null}/></AdminShell>;
}
