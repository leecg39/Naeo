import {adminPageUser} from '@/server/current-user';
import {pageSettingsDatabase} from '@/server/content/public-pages';
import {listAdminPlans} from '@/server/billing/plans';
import {listAdminCoupons} from '@/server/billing/coupons';
import AdminShell from '@/components/admin/AdminShell';
import PlansCoupons from '@/components/admin/PlansCoupons';
export const dynamic='force-dynamic';
async function load(userId:string){
 const db=await pageSettingsDatabase();
 return{initialPlans:listAdminPlans(db,userId),initialCoupons:listAdminCoupons(db,userId,{pageSize:100}),now:Date.now()};
}
export default async function AdminBillingPage(){
 const user=await adminPageUser('/admin/billing');
 return <AdminShell title="요금제·쿠폰" path="/admin/billing"><PlansCoupons {...await load(user.id)}/></AdminShell>;
}
