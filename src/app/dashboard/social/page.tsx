import PageAnnouncements from '@/components/content/PageAnnouncements';
import {pageUser} from '@/server/current-user';
import {database} from '@/server/database';
import {getProfile} from '@/server/profiles';
import {listProjects} from '@/server/creative/projects';
import AccountShell from '@/components/account/AccountShell';
import SocialStudio from '@/components/creative/SocialStudio';
export const dynamic='force-dynamic';
export default async function SocialStudioPage(){
 const user=await pageUser('/dashboard/social'),db=database();
 return <AccountShell title="소셜 제작" nickname={getProfile(db,user.id).nickname} path="/dashboard/social" admin={user.role==='admin'}><SocialStudio initial={listProjects(db,user.id)}/><PageAnnouncements path="/dashboard/social"/></AccountShell>;
}
