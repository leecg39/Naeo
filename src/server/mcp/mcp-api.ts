import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Database} from '../database';
import {AppError} from '../errors';
import {appOrigin,json,rateLimit,readRequestBytes} from '../http';
import {authenticateBearer,mcpResource} from '../oauth/authz';
import {callTool,toolList} from './tools';

export const SUPPORTED_VERSIONS=['2025-06-18','2025-03-26'];
export const resourceMetadataUrl=()=>`${appOrigin()}/.well-known/oauth-protected-resource/api/mcp`;
const rpc=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.string(),z.number()]).optional(),method:z.string().max(100),params:z.record(z.string(),z.unknown()).optional()});
const reply=(id:string|number|null,body:{result:unknown}|{error:{code:number;message:string}})=>json({jsonrpc:'2.0',id,...body});
function unauthorized(e:AppError):Response{
 const challenge=`Bearer resource_metadata="${resourceMetadataUrl()}"${e.code==='invalid_token'?', error="invalid_token"':''}`;
 return json({error:e.code,error_description:e.message},401,{'WWW-Authenticate':challenge});
}

/**
 * MCP Streamable HTTP(명세 2025-06-18): POST 한 건의 JSON-RPC 메시지를 받아 JSON으로 응답한다(서버 시작 스트림 없음 → GET 405).
 * 다른 사이트 Origin은 거절(DNS 리바인딩 방지), 접근 토큰은 /api/mcp 대상이어야 한다.
 */
export async function mcpApi(db:Database,request:Request,now=Date.now()):Promise<Response|null>{
 if(new URL(request.url).pathname!=='/api/mcp')return null;
 const origin=request.headers.get('origin');
 if(origin&&origin!==appOrigin())return json({error:'forbidden_origin'},403);
 if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
 let who;
 try{who=authenticateBearer(db,request.headers.get('authorization'),mcpResource(),now);}catch(e){if(e instanceof AppError)return unauthorized(e);throw e;}
 rateLimit(db,`mcp:${who.userId}:${who.clientId}`,120,60_000,now);
 const bytes=await readRequestBytes(request,512*1024);
 let message:z.infer<typeof rpc>;
 try{message=rpc.parse(JSON.parse(bytes.toString('utf8')));}catch{return reply(null,{error:{code:-32700,message:'Parse error'}});}
 if(message.id===undefined)return new Response(null,{status:202});
 const id=message.id,p=message.params??{};
 switch(message.method){
  case 'initialize':{
   const asked=typeof p.protocolVersion==='string'?p.protocolVersion:'';
   return reply(id,{result:{protocolVersion:SUPPORTED_VERSIONS.includes(asked)?asked:SUPPORTED_VERSIONS[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'naeo',title:'NAEO',version:'1.0.0'},
    instructions:'NAEO 블로그 진단·초안 도구입니다. 초안을 만들면 NAEO 글쓰기 화면에서 이어서 고칠 수 있습니다.'}});
  }
  case 'ping':return reply(id,{result:{}});
  case 'tools/list':return reply(id,{result:{tools:toolList()}});
  case 'tools/call':{
   const name=typeof p.name==='string'?p.name:'';
   const out=callTool({db,userId:who.userId,scopes:who.scopes,now},name,p.arguments??{});
   if('unknown' in out)return reply(id,{error:{code:-32602,message:`Unknown tool: ${name.slice(0,60)}`}});
   db.prepare('INSERT INTO mcp_calls(id,user_id,client_id,tool,ok,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),who.userId,who.clientId,name,out.ok?1:0,now);
   return reply(id,{result:out.result});
  }
  default:return reply(id,{error:{code:-32601,message:'Method not found'}});
 }
}
