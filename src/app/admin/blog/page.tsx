import {adminPageUser} from '@/server/current-user';
import {contentDatabase} from '@/server/content/public-pages';
import {listAdminArticles,listAdminCategories} from '@/server/content/admin-articles';
import AdminShell from '@/components/admin/AdminShell';
import ArticlesManager from '@/components/admin/ArticlesManager';
export const dynamic='force-dynamic';
function load(userId:string){
 const db=contentDatabase();
 return{initial:listAdminArticles(db,userId,{}),initialCategories:listAdminCategories(db,userId),now:Date.now()};
}
export default async function AdminBlogPage(){
 const user=await adminPageUser('/admin/blog');
 return <AdminShell title="매거진 관리" path="/admin/blog"><ArticlesManager {...load(user.id)}/></AdminShell>;
}
