import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput,version} from '../validation';

export type CreativeKind='carousel'|'ad'|'video';
export type Theme={background:string;accent:string;text:string};
export type Slide={id:string;position:number;heading:string;body:string;caption:string;background:string;version:number;updatedAt:number};
export type Project={id:string;kind:CreativeKind;title:string;width:number;height:number;theme:Theme;version:number;createdAt:number;updatedAt:number;slides:Slide[]};
export const PROJECT_LIMIT=30,SLIDE_LIMIT=20;
/** 종류별 캔버스(캡처 화면 기준): 캐러셀 1080×1440, 광고 1080×1350, 영상 1920×1080. */
export const PRESETS:Record<CreativeKind,{width:number;height:number;label:string}>={carousel:{width:1080,height:1440,label:'캐러셀'},ad:{width:1080,height:1350,label:'광고'},video:{width:1920,height:1080,label:'영상 장면'}};
const DEFAULT_THEME:Theme={background:'#0b0f0c',accent:'#03c75a',text:'#ffffff'};
const hex=z.string().regex(/^#[0-9a-f]{6}$/,'색은 #rrggbb(소문자) 형식입니다.');
const theme=z.object({background:hex,accent:hex,text:hex}).strict();
const createInput=z.object({kind:z.enum(['carousel','ad','video']),title:z.string().trim().min(1).max(100)}).strict();
const updateInput=z.object({title:z.string().trim().min(1).max(100).optional(),theme:theme.optional(),version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
const slideFields={heading:z.string().trim().max(120),body:z.string().trim().max(600),caption:z.string().trim().max(80),background:z.union([z.literal(''),hex])};
const addInput=z.object({...slideFields,position:z.number().int().min(0).max(SLIDE_LIMIT)}).partial().strict();
const slideUpdate=z.object(slideFields).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
const moveInput=z.object({position:z.number().int().min(0).max(SLIDE_LIMIT-1)}).strict();
const SLIDE_SELECT='SELECT id,position,heading,body,caption,background,version,updated_at AS updatedAt FROM creative_slides';

function row(db:Database,ownerId:string,id:string){
 const p=db.prepare('SELECT id,kind,title,width,height,theme_json AS themeJson,version,created_at AS createdAt,updated_at AS updatedAt FROM creative_projects WHERE id=? AND owner_id=?').get(id,ownerId) as (Omit<Project,'theme'|'slides'>&{themeJson:string})|undefined;
 if(!p)throw new AppError(404,'NOT_FOUND','프로젝트를 찾을 수 없습니다.');
 return p;
}
const slidesOf=(db:Database,projectId:string)=>(db.prepare(`${SLIDE_SELECT} WHERE project_id=? ORDER BY position`).all(projectId) as Slide[]).map(s=>({...s}));
/** 내 프로젝트(슬라이드 포함). 남의 프로젝트는 404. */
export function getProject(db:Database,ownerId:string,id:string):Project{
 const {themeJson,...p}=row(db,ownerId,id);
 return{...p,theme:JSON.parse(themeJson) as Theme,slides:slidesOf(db,id)};
}
export function listProjects(db:Database,ownerId:string){
 return (db.prepare('SELECT p.id,p.kind,p.title,p.width,p.height,p.version,p.updated_at AS updatedAt,(SELECT count(*) FROM creative_slides s WHERE s.project_id=p.id) AS slideCount FROM creative_projects p WHERE owner_id=? ORDER BY updated_at DESC').all(ownerId) as {id:string;kind:CreativeKind;title:string;width:number;height:number;version:number;updatedAt:number;slideCount:number}[]).map(p=>({...p}));
}
const touch=(db:Database,id:string,now:number)=>db.prepare('UPDATE creative_projects SET updated_at=? WHERE id=?').run(now,id);
function insertSlide(db:Database,projectId:string,position:number,f:Partial<Record<'heading'|'body'|'caption'|'background',string>>,now:number):string{
 const id=randomUUID();
 db.prepare('INSERT INTO creative_slides(id,project_id,position,heading,body,caption,background,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,projectId,position,f.heading??'',f.body??'',f.caption??'',f.background??'',now,now);
 return id;
}
/** 위치 다시 매기기: 모두 큰 값으로 옮긴 뒤 0부터 채워 UNIQUE(project,position) 충돌을 피한다. */
function renumber(db:Database,projectId:string,ids:string[]){
 db.prepare('UPDATE creative_slides SET position=position+10000 WHERE project_id=?').run(projectId);
 const set=db.prepare('UPDATE creative_slides SET position=? WHERE id=?');
 ids.forEach((id,i)=>set.run(i,id));
}

export function createProject(db:Database,ownerId:string,input:unknown,now=Date.now()):Project{
 const v=createInput.parse(input);
 return transaction(db,()=>{
  if((db.prepare('SELECT count(*) AS n FROM creative_projects WHERE owner_id=?').get(ownerId) as {n:number}).n>=PROJECT_LIMIT)throw new AppError(409,'PROJECT_LIMIT',`프로젝트는 ${PROJECT_LIMIT}개까지 만들 수 있습니다.`);
  const id=randomUUID(),size=PRESETS[v.kind];
  db.prepare('INSERT INTO creative_projects(id,owner_id,kind,title,width,height,theme_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,ownerId,v.kind,v.title,size.width,size.height,JSON.stringify(DEFAULT_THEME),now,now);
  insertSlide(db,id,0,{heading:v.title,caption:'NAEO'},now);
  audit(db,ownerId,'creative.project.create','creative_project',id,{kind:v.kind});
  return getProject(db,ownerId,id);
 });
}
export function updateProject(db:Database,ownerId:string,id:string,input:unknown,now=Date.now()):Project{
 const v=updateInput.parse(input);
 return transaction(db,()=>{
  const p=row(db,ownerId,id);
  if(p.version!==v.version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 새로고침해주세요.');
  db.prepare('UPDATE creative_projects SET title=?,theme_json=?,version=version+1,updated_at=? WHERE id=?').run(v.title??p.title,v.theme?JSON.stringify(v.theme):p.themeJson,now,id);
  return getProject(db,ownerId,id);
 });
}
export function deleteProject(db:Database,ownerId:string,id:string,input:unknown){
 const {version:expected}=deleteInput.parse(input);
 return transaction(db,()=>{
  if(row(db,ownerId,id).version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 새로고침해주세요.');
  db.prepare('DELETE FROM creative_projects WHERE id=?').run(id);
  audit(db,ownerId,'creative.project.delete','creative_project',id);
  return{deleted:true};
 });
}
export function duplicateProject(db:Database,ownerId:string,id:string,now=Date.now()):Project{
 return transaction(db,()=>{
  const src=getProject(db,ownerId,id);
  if((db.prepare('SELECT count(*) AS n FROM creative_projects WHERE owner_id=?').get(ownerId) as {n:number}).n>=PROJECT_LIMIT)throw new AppError(409,'PROJECT_LIMIT',`프로젝트는 ${PROJECT_LIMIT}개까지 만들 수 있습니다.`);
  const copy=randomUUID();
  db.prepare('INSERT INTO creative_projects(id,owner_id,kind,title,width,height,theme_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(copy,ownerId,src.kind,`${src.title} (복사본)`.slice(0,100),src.width,src.height,JSON.stringify(src.theme),now,now);
  for(const s of src.slides)insertSlide(db,copy,s.position,s,now);
  audit(db,ownerId,'creative.project.duplicate','creative_project',copy,{from:id});
  return getProject(db,ownerId,copy);
 });
}

function ownedSlide(db:Database,ownerId:string,projectId:string,slideId:string):Slide{
 row(db,ownerId,projectId);
 const s=db.prepare(`${SLIDE_SELECT} WHERE id=? AND project_id=?`).get(slideId,projectId) as Slide|undefined;
 if(!s)throw new AppError(404,'NOT_FOUND','슬라이드를 찾을 수 없습니다.');
 return{...s};
}
const getSlide=(db:Database,id:string)=>({...(db.prepare(`${SLIDE_SELECT} WHERE id=?`).get(id) as Slide)});
/** 슬라이드 추가(기본 맨 뒤, position을 주면 그 자리에 끼움). */
export function addSlide(db:Database,ownerId:string,projectId:string,input:unknown,now=Date.now()):Slide{
 const v=addInput.parse(input);
 return transaction(db,()=>{
  const ids=slidesOf(db,(row(db,ownerId,projectId),projectId)).map(s=>s.id);
  if(ids.length>=SLIDE_LIMIT)throw new AppError(409,'SLIDE_LIMIT',`슬라이드는 ${SLIDE_LIMIT}장까지입니다.`);
  const id=insertSlide(db,projectId,10000+ids.length+1,v,now);
  const at=Math.min(v.position??ids.length,ids.length);
  renumber(db,projectId,[...ids.slice(0,at),id,...ids.slice(at)]);
  touch(db,projectId,now);
  return getSlide(db,id);
 });
}
export function updateSlide(db:Database,ownerId:string,projectId:string,slideId:string,input:unknown,now=Date.now()):Slide{
 const {version:expected,...f}=slideUpdate.parse(input);
 return transaction(db,()=>{
  const s=ownedSlide(db,ownerId,projectId,slideId);
  if(s.version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 새로고침해주세요.');
  db.prepare('UPDATE creative_slides SET heading=?,body=?,caption=?,background=?,version=version+1,updated_at=? WHERE id=?').run(f.heading??s.heading,f.body??s.body,f.caption??s.caption,f.background??s.background,now,slideId);
  touch(db,projectId,now);
  return getSlide(db,slideId);
 });
}
export function deleteSlide(db:Database,ownerId:string,projectId:string,slideId:string,now=Date.now()){
 return transaction(db,()=>{
  ownedSlide(db,ownerId,projectId,slideId);
  const ids=slidesOf(db,projectId).map(s=>s.id);
  if(ids.length<=1)throw new AppError(409,'LAST_SLIDE','마지막 한 장은 지울 수 없습니다.');
  db.prepare('DELETE FROM creative_slides WHERE id=?').run(slideId);
  renumber(db,projectId,ids.filter(id=>id!==slideId));
  touch(db,projectId,now);
  return{deleted:true};
 });
}
export function moveSlide(db:Database,ownerId:string,projectId:string,slideId:string,input:unknown,now=Date.now()):Slide{
 const {position}=moveInput.parse(input);
 return transaction(db,()=>{
  ownedSlide(db,ownerId,projectId,slideId);
  const rest=slidesOf(db,projectId).map(s=>s.id).filter(id=>id!==slideId);
  const at=Math.min(position,rest.length);
  renumber(db,projectId,[...rest.slice(0,at),slideId,...rest.slice(at)]);
  touch(db,projectId,now);
  return getSlide(db,slideId);
 });
}
/** 바로 뒤에 같은 내용의 슬라이드를 끼운다. */
export function duplicateSlide(db:Database,ownerId:string,projectId:string,slideId:string,now=Date.now()):Slide{
 const s=transaction(db,()=>ownedSlide(db,ownerId,projectId,slideId));
 return addSlide(db,ownerId,projectId,{heading:s.heading,body:s.body,caption:s.caption,background:s.background,position:s.position+1},now);
}
