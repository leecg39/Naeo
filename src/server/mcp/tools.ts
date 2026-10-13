import {z} from 'zod';
import type {Database} from '../database';
import {AppError} from '../errors';
import {balance} from '../credits/ledger';
import {latestScanResult} from '../analysis/results';
import {remainingScansToday} from '../jobs/queue';
import {createDraft,getDraft,listDrafts} from '../writing/drafts';
import {requestGeneration} from '../generation/generation';
import type {Scope} from '../oauth/authz';

export type ToolContext={db:Database;userId:string;scopes:Scope[];now:number};
type Tool={name:string;title:string;description:string;scope:Scope;inputSchema:Record<string,unknown>;run:(ctx:ToolContext,args:unknown)=>unknown};
const object=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
const str=(description:string,maxLength:number)=>({type:'string',description,maxLength});

/** MCP 도구: 각 도구는 필요한 범위가 있고, 기존 서버 기능(같은 검증·차감 규칙)을 그대로 호출한다. */
export const TOOLS:Tool[]=[
 {name:'naeo_blog_status',title:'내 블로그 진단 상태',description:'대표 블로그와 최근 진단 점수(5가지 기준), 오늘 남은 진단 횟수를 알려준다.',scope:'naeo:read',inputSchema:object({}),
  run:({db,userId,now})=>{
   const blog=db.prepare('SELECT id,naver_id AS naverId,title FROM blogs WHERE owner_id=? AND is_primary=1').get(userId) as {id:string;naverId:string;title:string}|undefined;
   if(!blog)return{blog:null,message:'등록된 대표 블로그가 없습니다. NAEO 설정에서 블로그를 등록하세요.'};
   const r=latestScanResult(db,userId,blog.id);
   return{blog:{naverId:blog.naverId,title:blog.title},latest:r?{score:r.score,measuredAt:new Date(r.measuredAt).toISOString(),criteria:r.criteria.map(c=>({key:c.key,score:c.score})),actions:r.actions.slice(0,5)}:null,scansLeftToday:remainingScansToday(db,userId,now)};
  }},
 {name:'naeo_token_balance',title:'토큰 잔액',description:'AI 글쓰기에 쓰는 내 토큰 잔액.',scope:'naeo:read',inputSchema:object({}),run:({db,userId})=>({balance:balance(db,userId)})},
 {name:'naeo_list_drafts',title:'내 초안 목록',description:'최근 초안(제목·상태·수정 시각)을 20개까지 보여준다.',scope:'naeo:read',inputSchema:object({q:str('제목 검색어',100)}),
  run:({db,userId},args)=>{const {q}=z.object({q:z.string().max(100).default('')}).strict().parse(args??{});return{drafts:listDrafts(db,userId,{q,pageSize:20}).data.map(d=>({id:d.id,title:d.title,status:d.status,updatedAt:new Date(d.updatedAt).toISOString()}))};}},
 {name:'naeo_get_draft',title:'초안 보기',description:'초안 하나의 제목·키워드·본문(마크다운)을 가져온다.',scope:'naeo:read',inputSchema:object({id:str('초안 id',36)},['id']),
  run:({db,userId},args)=>{const {id}=z.object({id:z.uuid()}).strict().parse(args);const d=getDraft(db,userId,id) as {id:string;title:string;keyword:string;body:string;status:string};return{id:d.id,title:d.title,keyword:d.keyword,status:d.status,body:d.body};}},
 {name:'naeo_create_draft',title:'초안 만들기',description:'제목과 본문(마크다운)으로 NAEO에 새 초안을 저장한다.',scope:'naeo:write',inputSchema:object({title:str('제목',200),keyword:str('대표 키워드',60),body:str('본문(마크다운)',100000)},['title']),
  run:({db,userId,now},args)=>{const d=createDraft(db,userId,args,now);return{id:d.id,title:d.title,editUrl:`/dashboard/write?draft=${d.id}`};}},
 {name:'naeo_request_generation',title:'AI 글 생성 요청',description:'키워드로 AI 글 생성을 요청하고 토큰을 차감한다(공급자 미설정이면 차감 없이 실패).',scope:'naeo:generate',
  inputSchema:object({keyword:str('키워드',60),title:str('원하는 제목',200),experience:str('내 경험 메모',1000),idempotencyKey:str('같은 요청 반복 방지 키',100)},['keyword','idempotencyKey']),
  run:({db,userId,now},args)=>{const j=requestGeneration(db,userId,args,undefined,now);return{jobId:j.id,state:j.state,cost:j.cost};}},
];
export const toolList=()=>TOOLS.map(t=>({name:t.name,title:t.title,description:`${t.description} (필요 권한: ${t.scope})`,inputSchema:t.inputSchema}));

/** 도구 실행 결과(MCP CallToolResult). 입력·권한·업무 오류는 isError 결과로 돌려준다. */
export function callTool(ctx:ToolContext,name:string,args:unknown){
 const tool=TOOLS.find(t=>t.name===name);
 if(!tool)return{unknown:true as const};
 const fail=(text:string)=>({ok:false,result:{content:[{type:'text',text}],isError:true}});
 if(!ctx.scopes.includes(tool.scope))return fail(`이 연결에는 '${tool.scope}' 권한이 없습니다. NAEO 연결 시 해당 권한을 허용해주세요.`);
 try{
  const data=tool.run(ctx,args);
  return{ok:true,result:{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false}};
 }catch(e){
  if(e instanceof AppError)return fail(e.message);
  if(e instanceof z.ZodError)return fail(`입력 오류: ${e.issues.map(i=>`${i.path.join('.')||'(입력)'} ${i.message}`).join(', ')}`);
  throw e;
 }
}
