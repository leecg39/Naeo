import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { database } from './database';
import { SESSION_COOKIE, sessionUser } from './auth';

export async function currentUser() {
  return sessionUser(database(),(await cookies()).get(SESSION_COOKIE)?.value);
}
export async function pageUser(path:string) {
  const user=await currentUser();
  if(!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  return user;
}
