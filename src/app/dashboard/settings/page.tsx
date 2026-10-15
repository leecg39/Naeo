import PageAnnouncements from '@/components/content/PageAnnouncements';
import {EmailVerification} from '@/components/account/AccountMailForms';
import {mailStatus} from '@/server/mail/account-mail';
import {mailConfig} from '@/server/mail/provider';
import PersonalDataExport from '@/components/account/PersonalDataExport';
import {listPersonalExports} from '@/server/privacy/personal-export';
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
import BillingSection from '@/components/account/BillingSection';
import {currentSubscription} from '@/server/billing/subscriptions';
import {billingHistory} from '@/server/billing/history';
import {tossProvider} from '@/server/billing/provider';
import {balance} from '@/server/credits/ledger';
import ConnectionsSection from '@/components/account/ConnectionsSection';
import {hasPassword,listConnections} from '@/server/oauth/oauth';
import {oauthConfig} from '@/server/oauth/providers';
import ConnectedApps from '@/components/account/ConnectedApps';
import {listAuthorizedApps,mcpResource} from '@/server/oauth/authz';
import EngagementPanel from '@/components/account/EngagementPanel';
import {points,tutorial} from '@/server/engagement/service';

export const dynamic='force-dynamic';
function billingState(db:ReturnType<typeof database>,userId:string){
  return{subscription:currentSubscription(db,userId),...billingHistory(db,userId),paymentsConfigured:tossProvider()!==null,balance:balance(db,userId),now:Date.now()};
}
export default async function SettingsPage({searchParams}:{searchParams:Promise<{oauthLinked?:string;oauthError?:string}>}) {
  const {oauthLinked,oauthError}=await searchParams;
  const user=await pageUser('/dashboard/settings'),db=database();
  const profile=getProfile(db,user.id),blogs=listBlogs(db,user.id,{pageSize:100}).data;
  const token=(await cookies()).get(SESSION_COOKIE)!.value;
  const sessions=listSessions(db,user.id,token);
  return <AccountShell title="계정 설정" nickname={profile.nickname} path="/dashboard/settings" admin={user.role==='admin'}><div className="settings-sections"><SettingsForm initialProfile={profile} initialBlogs={blogs} email={user.email}/><EngagementPanel initialPoints={points(db,user.id,{pageSize:10})} initialTutorial={tutorial(db,user.id)}/><ContactPreferencesForm initialContact={getContact(db,user.id)} initialPreferences={getPreferences(db,user.id)}/><BillingSection initial={billingState(db,user.id)}/><ConnectionsSection initial={{connections:listConnections(db,user.id),hasPassword:hasPassword(db,user.id),configured:{google:oauthConfig('google')!==null,naver:oauthConfig('naver')!==null}}} linked={oauthLinked} error={oauthError}/><ConnectedApps key={user.version} initial={listAuthorizedApps(db,user.id)} mcpUrl={mcpResource()}/><PersonalDataExport key={`export-${user.version}`} initial={listPersonalExports(db,user.id,token)} hasPassword={hasPassword(db,user.id)}/><EmailVerification key={`mail-${user.version}`} email={user.email} initial={mailStatus(db,user.id,mailConfig())}/><SecurityForm user={user} initialSessions={sessions}/></div><PageAnnouncements path="/dashboard/settings"/></AccountShell>;
}
