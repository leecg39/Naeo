import { randomUUID } from 'node:crypto';
import type { Database } from './database';
import { transaction } from './database';
import { createBlogInput, updateBlogInput, deleteInput, paginationInput } from './validation';
import { AppError } from './errors';
import { audit } from './audit';

export type Blog = {id:string;ownerId:string;naverId:string;title:string;category:string;isPrimary:boolean;version:number;createdAt:number;updatedAt:number};
type BlogRow=Omit<Blog,'isPrimary'>&{isPrimary:number};
const columns='id,owner_id AS ownerId,naver_id AS naverId,title,category,is_primary AS isPrimary,version,created_at AS createdAt,updated_at AS updatedAt';
const deserialize=(row:BlogRow):Blog=>({...row,isPrimary:Boolean(row.isPrimary)});
export function getBlog(db:Database,userId:string,id:string):Blog {
  const row=db.prepare(`SELECT ${columns} FROM blogs WHERE id=? AND owner_id=?`).get(id,userId) as BlogRow|undefined;
  if(!row) throw new AppError(404,'NOT_FOUND','블로그를 찾을 수 없습니다.');
  return deserialize(row);
}
export function listBlogs(db:Database,userId:string,query:unknown={}) {
  const {page,pageSize,q}=paginationInput.parse(query);
  const search=`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;
  const where="owner_id=? AND (title LIKE ? ESCAPE '\\' OR naver_id LIKE ? ESCAPE '\\')";
  const {total}=db.prepare(`SELECT count(*) AS total FROM blogs WHERE ${where}`).get(userId,search,search) as {total:number};
  const rows=db.prepare(`SELECT ${columns} FROM blogs WHERE ${where} ORDER BY is_primary DESC,created_at DESC,id LIMIT ? OFFSET ?`).all(userId,search,search,pageSize,(page-1)*pageSize) as BlogRow[];
  return {data:rows.map(deserialize),pagination:{page,pageSize,total}};
}
function clearPrimary(db:Database,userId:string,exceptId:string) {
  db.prepare('UPDATE blogs SET is_primary=0,version=version+1,updated_at=? WHERE owner_id=? AND id<>? AND is_primary=1').run(Date.now(),userId,exceptId);
}
function duplicate(db:Database,userId:string,naverId:string,exceptId='') {
  if(db.prepare('SELECT id FROM blogs WHERE owner_id=? AND naver_id=? AND id<>?').get(userId,naverId,exceptId)) throw new AppError(409,'BLOG_EXISTS','이미 등록한 블로그입니다.');
}
export function createBlog(db:Database,userId:string,input:unknown):Blog {
  const valid=createBlogInput.parse(input);
  return transaction(db,()=>{
    duplicate(db,userId,valid.naverId);
    const {total}=db.prepare('SELECT count(*) AS total FROM blogs WHERE owner_id=?').get(userId) as {total:number};
    if(total>=20) throw new AppError(409,'BLOG_LIMIT','등록 가능한 블로그 수를 초과했습니다.');
    const id=randomUUID(),now=Date.now(),primary=valid.isPrimary||total===0;
    if(primary) clearPrimary(db,userId,id);
    db.prepare('INSERT INTO blogs(id,owner_id,naver_id,title,category,is_primary,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,userId,valid.naverId,valid.title,valid.category,Number(primary),now,now);
    audit(db,userId,'blog.create','blog',id);
    return getBlog(db,userId,id);
  });
}
export function updateBlog(db:Database,userId:string,id:string,input:unknown):Blog {
  const valid=updateBlogInput.parse(input);
  return transaction(db,()=>{
    const current=getBlog(db,userId,id);
    if(current.version!==valid.version) throw new AppError(409,'VERSION_CONFLICT','블로그 정보가 변경되었습니다. 새로고침 후 다시 시도해주세요.');
    const next={...current,...valid};
    duplicate(db,userId,next.naverId,id);
    if(next.isPrimary) clearPrimary(db,userId,id);
    db.prepare('UPDATE blogs SET naver_id=?,title=?,category=?,is_primary=?,version=version+1,updated_at=? WHERE id=? AND owner_id=? AND version=?').run(next.naverId,next.title,next.category,Number(next.isPrimary),Date.now(),id,userId,valid.version);
    audit(db,userId,'blog.update','blog',id,{fields:Object.keys(valid).filter(k=>k!=='version')});
    return getBlog(db,userId,id);
  });
}
export function deleteBlog(db:Database,userId:string,id:string,input:unknown) {
  const valid=deleteInput.parse(input);
  return transaction(db,()=>{
    const current=getBlog(db,userId,id);
    if(current.version!==valid.version) throw new AppError(409,'VERSION_CONFLICT','블로그 정보가 변경되었습니다. 새로고침 후 다시 시도해주세요.');
    db.prepare('DELETE FROM blogs WHERE id=? AND owner_id=? AND version=?').run(id,userId,valid.version);
    if(current.isPrimary) {
      const next=db.prepare('SELECT id FROM blogs WHERE owner_id=? ORDER BY created_at,id LIMIT 1').get(userId) as {id:string}|undefined;
      if(next) db.prepare('UPDATE blogs SET is_primary=1,version=version+1,updated_at=? WHERE id=?').run(Date.now(),next.id);
    }
    audit(db,userId,'blog.delete','blog',id);
    return {deleted:true};
  });
}
