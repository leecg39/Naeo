import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput,paginationInput,version} from '../validation';

export type DraftStatus='draft'|'ready'|'published'|'archived';
export type Draft={id:string;title:string;keyword:string;category:string;body:string;status:DraftStatus;publishedAt:number|null;version:number;createdAt:number;updatedAt:number};
export type DraftSummary=Omit<Draft,'body'>&{imageCount:number};
const SELECT='SELECT id,title,keyword,category,body,status,published_at AS publishedAt,version,created_at AS createdAt,updated_at AS updatedAt FROM drafts';
const fields={title:z.string().trim().min(1).max(200),keyword:z.string().trim().max(60),category:z.string().trim().max(30),body:z.string().max(100000)};
const createInput=z.object({...fields,keyword:fields.keyword.default(''),category:fields.category.default(''),body:fields.body.default('')}).strict();
const updateInput=z.object({...fields,status:z.enum(['draft','ready','published','archived'])}).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
const restoreInput=z.object({revision:z.number().int().positive(),version}).strict();
const queryInput=paginationInput.extend({status:z.enum(['draft','ready','published','archived']).optional()});
/** 허용 상태 전이: 발행한 글은 초안으로 되돌리지 않고 보관만 한다. */
const TRANSITIONS:Record<DraftStatus,DraftStatus[]>={draft:['ready','archived'],ready:['draft','published','archived'],published:['archived'],archived:['draft']};

export function ownedDraft(db:Database,ownerId:string,id:string):Draft{
 const r=db.prepare(`${SELECT} WHERE id=? AND owner_id=?`).get(id,ownerId) as Draft|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','초안을 찾을 수 없습니다.');
 return{...r};
}
function saveRevision(db:Database,d:Draft,now:number){
 db.prepare('INSERT INTO draft_revisions(id,draft_id,version,title,body,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(draft_id,version) DO NOTHING').run(randomUUID(),d.id,d.version,d.title,d.body,now);
}

/** 초안 한 건과 첫 수정 이력을 넣는다(호출한 쪽 트랜잭션 안에서 쓴다). */
export function insertDraftRow(db:Database,ownerId:string,v:{title:string;keyword:string;category:string;body:string},now:number,action='draft.create'):Draft{
 const id=randomUUID();
 db.prepare('INSERT INTO drafts(id,owner_id,title,keyword,category,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,ownerId,v.title,v.keyword,v.category,v.body,now,now);
 const d=ownedDraft(db,ownerId,id);
 saveRevision(db,d,now);
 audit(db,ownerId,action,'draft',id);
 return d;
}

export function createDraft(db:Database,ownerId:string,input:unknown,now=Date.now()):Draft{
 const v=createInput.parse(input);
 return transaction(db,()=>insertDraftRow(db,ownerId,v,now));
}

export function getDraft(db:Database,ownerId:string,id:string){
 const d=ownedDraft(db,ownerId,id);
 const revisions=(db.prepare('SELECT version,created_at AS createdAt FROM draft_revisions WHERE draft_id=? ORDER BY version DESC').all(id) as {version:number;createdAt:number}[]).map(r=>({...r}));
 return{...d,revisions};
}

export function listDrafts(db:Database,ownerId:string,query:unknown){
 const {page,pageSize,q,status}=queryInput.parse(query);
 const like=`%${q.replace(/[\\%_]/g,c=>'\\'+c)}%`;
 const where=["owner_id=?","(title LIKE ? ESCAPE '\\' OR keyword LIKE ? ESCAPE '\\')"],params:(string|number)[]=[ownerId,like,like];
 if(status){where.push('status=?');params.push(status);}
 const sql=`WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total FROM drafts ${sql}`).get(...params) as {total:number};
 const rows=db.prepare(`SELECT id,title,keyword,category,status,published_at AS publishedAt,version,created_at AS createdAt,updated_at AS updatedAt,
  (SELECT count(*) FROM media_files m WHERE m.draft_id=drafts.id) AS imageCount FROM drafts ${sql} ORDER BY updated_at DESC,rowid DESC LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as DraftSummary[];
 return{data:rows.map(r=>({...r})),pagination:{page,pageSize,total}};
}

function apply(db:Database,ownerId:string,id:string,changes:Partial<Pick<Draft,'title'|'keyword'|'category'|'body'|'status'>>,expected:number,action:string):Draft{
 const now=Date.now();
 return transaction(db,()=>{
  const cur=ownedDraft(db,ownerId,id);
  if(cur.version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 저장했습니다. 최신 내용을 불러와주세요.');
  const next={...cur,...changes};
  if(changes.status&&changes.status!==cur.status){
   if(!TRANSITIONS[cur.status].includes(changes.status))throw new AppError(409,'INVALID_TRANSITION',`'${cur.status}' 상태에서 '${changes.status}'(으)로 바꿀 수 없습니다.`);
   if((changes.status==='ready'||changes.status==='published')&&!next.body.trim())throw new AppError(409,'DRAFT_EMPTY','본문이 비어 있으면 발행 준비로 바꿀 수 없습니다.');
  }
  const publishedAt=changes.status==='published'&&cur.status!=='published'?now:cur.publishedAt;
  db.prepare('UPDATE drafts SET title=?,keyword=?,category=?,body=?,status=?,published_at=?,version=version+1,updated_at=? WHERE id=? AND version=?')
   .run(next.title,next.keyword,next.category,next.body,next.status,publishedAt,now,id,expected);
  const updated=ownedDraft(db,ownerId,id);
  if(updated.title!==cur.title||updated.body!==cur.body)saveRevision(db,updated,now);
  audit(db,ownerId,action,'draft',id,{fields:Object.keys(changes)});
  return updated;
 });
}

export function updateDraft(db:Database,ownerId:string,id:string,input:unknown):Draft{
 const {version:expected,...changes}=updateInput.parse(input);
 return apply(db,ownerId,id,changes,expected,'draft.update');
}

/** 지난 버전의 제목·본문으로 되돌린다(상태는 유지). */
export function restoreDraftRevision(db:Database,ownerId:string,id:string,input:unknown):Draft{
 const {revision,version:expected}=restoreInput.parse(input);
 ownedDraft(db,ownerId,id);
 const r=db.prepare('SELECT title,body FROM draft_revisions WHERE draft_id=? AND version=?').get(id,revision) as {title:string;body:string}|undefined;
 if(!r)throw new AppError(404,'REVISION_NOT_FOUND','해당 버전을 찾을 수 없습니다.');
 return apply(db,ownerId,id,{title:r.title,body:r.body},expected,'draft.restore');
}

/** 초안을 지운다. 연결된 사진은 초안 연결만 풀려 내 사진함에 남고, 공유 링크는 함께 사라진다. */
export function deleteDraft(db:Database,ownerId:string,id:string,input:unknown){
 const {version:expected}=deleteInput.parse(input);
 return transaction(db,()=>{
  if(ownedDraft(db,ownerId,id).version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 저장했습니다. 최신 내용을 불러와주세요.');
  db.prepare('DELETE FROM drafts WHERE id=? AND version=?').run(id,expected);
  audit(db,ownerId,'draft.delete','draft',id);
  return{deleted:true};
 });
}
