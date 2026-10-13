import { pageUser } from '@/server/current-user';
import { database } from '@/server/database';
import { getProfile } from '@/server/profiles';
import { listBlogs } from '@/server/blogs';
import AccountShell from '@/components/account/AccountShell';
import SettingsForm from '@/components/account/SettingsForm';

export const dynamic='force-dynamic';
export default async function SettingsPage() {
  const user=await pageUser('/dashboard/settings'),db=database();
  const profile=getProfile(db,user.id),blogs=listBlogs(db,user.id,{pageSize:100}).data;
  return <AccountShell title="계정 설정" nickname={profile.nickname} path="/dashboard/settings"><SettingsForm initialProfile={profile} initialBlogs={blogs} email={user.email}/></AccountShell>;
}
