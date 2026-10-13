import { pageUser } from '@/server/current-user';
import { database } from '@/server/database';
import { getProfile } from '@/server/profiles';
import { listBlogs } from '@/server/blogs';
import AccountShell from '@/components/account/AccountShell';
import SettingsForm from '@/components/account/SettingsForm';
import SecurityForm from '@/components/account/SecurityForm';
import ContactPreferencesForm from '@/components/account/ContactPreferencesForm';
import {getContact,getPreferences} from '@/server/preferences';
import {listSessions} from '@/server/account-security';
import {cookies} from 'next/headers';
import {SESSION_COOKIE} from '@/server/auth';

export const dynamic='force-dynamic';
export default async function SettingsPage() {
  const user=await pageUser('/dashboard/settings'),db=database();
  const profile=getProfile(db,user.id),blogs=listBlogs(db,user.id,{pageSize:100}).data;
  const sessions=listSessions(db,user.id,(await cookies()).get(SESSION_COOKIE)!.value);
  return <AccountShell title="계정 설정" nickname={profile.nickname} path="/dashboard/settings" admin={user.role==='admin'}><div className="settings-sections"><SettingsForm initialProfile={profile} initialBlogs={blogs} email={user.email}/><ContactPreferencesForm initialContact={getContact(db,user.id)} initialPreferences={getPreferences(db,user.id)}/><SecurityForm user={user} initialSessions={sessions}/></div></AccountShell>;
}
