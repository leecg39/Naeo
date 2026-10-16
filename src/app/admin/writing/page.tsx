import {adminPageUser} from '@/server/current-user';
import {database} from '@/server/database';
import {listAdminTemplates} from '@/server/generation/templates';
import {listAdminGenerations} from '@/server/generation/admin-generations';
import {imageGenerationAvailable,providerConfig} from '@/server/generation/generation';
import {openAIConnectionConfig} from '@/server/openai/config';
import AdminShell from '@/components/admin/AdminShell';
import WritingAdmin from '@/components/admin/WritingAdmin';
export const dynamic='force-dynamic';
function load(userId:string){
 const db=database();
 return{initialTemplates:listAdminTemplates(db,userId),initialJobs:listAdminGenerations(db,userId,{pageSize:30}),aiConfigured:providerConfig().apiKey!==''||openAIConnectionConfig()!==null,imageConfigured:imageGenerationAvailable()};
}
export default async function AdminWritingPage(){
 const user=await adminPageUser('/admin/writing');
 return <AdminShell title="글쓰기 관리" path="/admin/writing"><WritingAdmin {...load(user.id)}/></AdminShell>;
}
