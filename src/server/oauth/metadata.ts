import {appOrigin} from '../http';
import {mcpResource,SCOPES} from './authz';

/** RFC 8414 인가 서버 메타데이터. */
export const authorizationServerMetadata=()=>{const o=appOrigin();return{
 issuer:o,authorization_endpoint:`${o}/oauth/consent`,token_endpoint:`${o}/api/oauth/token`,registration_endpoint:`${o}/api/oauth/register`,revocation_endpoint:`${o}/api/oauth/revoke`,
 response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],
 token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],scopes_supported:[...SCOPES]};};
/** RFC 9728 보호 리소스 메타데이터(/api/mcp). */
export const protectedResourceMetadata=()=>({resource:mcpResource(),authorization_servers:[appOrigin()],scopes_supported:[...SCOPES],bearer_methods_supported:['header'],resource_name:'NAEO MCP'});
export const metadataResponse=(body:unknown)=>Response.json(body,{headers:{'Cache-Control':'public, max-age=300','Access-Control-Allow-Origin':'*'}});
