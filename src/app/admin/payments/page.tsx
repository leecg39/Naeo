import {adminPageUser} from '@/server/current-user';
import {contentDatabase} from '@/server/content/public-pages';
import {listAdminPayments} from '@/server/billing/payments';
import {listAdminRefunds} from '@/server/billing/refunds';
import {tossProvider} from '@/server/billing/provider';
import AdminShell from '@/components/admin/AdminShell';
import PaymentsRefunds from '@/components/admin/PaymentsRefunds';
export const dynamic='force-dynamic';
export default async function AdminPaymentsPage(){
 const user=await adminPageUser('/admin/payments'),db=contentDatabase();
 return <AdminShell title="결제·환불" path="/admin/payments"><PaymentsRefunds initialPayments={listAdminPayments(db,user.id,{pageSize:100})} initialRefunds={listAdminRefunds(db,user.id,{pageSize:100})} configured={tossProvider()!==null}/></AdminShell>;
}
