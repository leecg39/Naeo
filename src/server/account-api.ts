import {personalExportApi} from './privacy/api';
import type {Database} from './database';
import {requireAdmin,tokenHash,type User} from './auth';
import {body,json,sessionCookie,cookieToken,rateLimit} from './http';
import {changePassword,deleteAccount,listSessions,revokeSession,revokeOtherSessions} from './account-security';
import {listUsers,managedUser,createUser,updateUser,removeUser,listAudit} from './admin-users';
import {getContact,saveContact,deleteContact,getPreferences,savePreferences} from './preferences';
import {changePasswordInput,deleteAccountInput,createUserInput,updateUserInput,deleteUserInput,createContactInput,updateContactInput,deleteInput,preferencesInput} from './validation';

export async function accountApi(db:Database,request:Request,user:User):Promise<Response|null> {
  const {pathname:path,searchParams}=new URL(request.url),method=request.method,token=cookieToken(request)!;
  const exportResponse=await personalExportApi(db,request,user);if(exportResponse)return exportResponse;
  const securityLimit=()=>rateLimit(db,`security:${user.id}`,20,15*60*1000);
  if(path==='/api/auth/password'&&method==='PATCH') {
    securityLimit();const result=await changePassword(db,user.id,await body(request,changePasswordInput));
    return json({data:{changed:true}},200,{'Set-Cookie':sessionCookie(result.token)});
  }
  if(path==='/api/auth/account'&&method==='DELETE') {
    securityLimit();
    const session=db.prepare('SELECT created_at AS createdAt FROM sessions WHERE token_hash=? AND user_id=?').get(tokenHash(token),user.id) as {createdAt:number}|undefined;
    const result=await deleteAccount(db,user.id,await body(request,deleteAccountInput),session?.createdAt);
    return json({data:result},200,{'Set-Cookie':sessionCookie('',0)});
  }
  if(path==='/api/auth/sessions') {
    if(method==='GET')return json({data:listSessions(db,user.id,token)});
    if(method==='DELETE')return json({data:revokeOtherSessions(db,user.id,token)});
  }
  const sessionMatch=path.match(/^\/api\/auth\/sessions\/([a-f0-9-]{32,36})$/);
  if(sessionMatch&&method==='DELETE') {
    const result=revokeSession(db,user.id,sessionMatch[1],token);
    return json({data:result},200,result.current?{'Set-Cookie':sessionCookie('',0)}:undefined);
  }
  if(path==='/api/contact-details') {
    if(method==='GET')return json({data:getContact(db,user.id)});
    if(method==='POST')return json({data:saveContact(db,user.id,await body(request,createContactInput),true)},201);
    if(method==='PATCH')return json({data:saveContact(db,user.id,await body(request,updateContactInput))});
    if(method==='DELETE')return json({data:deleteContact(db,user.id,await body(request,deleteInput))});
  }
  if(path==='/api/preferences') {
    if(method==='GET')return json({data:getPreferences(db,user.id)});
    if(method==='PATCH')return json({data:savePreferences(db,user.id,await body(request,preferencesInput))});
  }
  if(!path.startsWith('/api/admin/'))return null;
  requireAdmin(user);
  if(path==='/api/admin/users') {
    if(method==='GET')return json(listUsers(db,user.id,Object.fromEntries(searchParams)));
    if(method==='POST'){securityLimit();return json({data:await createUser(db,user.id,await body(request,createUserInput))},201);}
  }
  const userMatch=path.match(/^\/api\/admin\/users\/([a-f0-9-]{36})$/);
  if(userMatch) {
    if(method==='GET')return json({data:managedUser(db,user.id,userMatch[1])});
    if(method==='PATCH'){securityLimit();return json({data:await updateUser(db,user.id,userMatch[1],await body(request,updateUserInput))});}
    if(method==='DELETE'){securityLimit();return json({data:await removeUser(db,user.id,userMatch[1],await body(request,deleteUserInput))});}
  }
  if(path==='/api/admin/audit'&&method==='GET')return json(listAudit(db,user.id,Object.fromEntries(searchParams)));
  return null;
}
