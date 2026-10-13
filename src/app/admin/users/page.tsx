import {adminPageUser} from '@/server/current-user';
import {database} from '@/server/database';
import {listUsers} from '@/server/admin-users';
import AdminShell from '@/components/admin/AdminShell';
import UsersManager from '@/components/admin/UsersManager';
export const dynamic='force-dynamic';
export default async function UsersPage(){const user=await adminPageUser('/admin/users');return <AdminShell title="사용자 관리" path="/admin/users"><UsersManager initial={listUsers(database(),user.id,{})} currentUserId={user.id}/></AdminShell>;}
