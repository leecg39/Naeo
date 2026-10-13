import {adminPageUser} from '@/server/current-user';
import {database} from '@/server/database';
import {listAdminScans,scanHealth} from '@/server/jobs/admin-scans';
import AdminShell from '@/components/admin/AdminShell';
import ScanHealthManager from '@/components/admin/ScanHealthManager';
export const dynamic='force-dynamic';
function load(userId:string){
 const db=database();
 return{initialHealth:scanHealth(db,userId),initialJobs:listAdminScans(db,userId,{pageSize:30})};
}
export default async function ScanHealthPage(){
 const user=await adminPageUser('/admin/scan-health');
 return <AdminShell title="스캔 상태" path="/admin/scan-health"><ScanHealthManager {...load(user.id)}/></AdminShell>;
}
