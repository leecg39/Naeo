import type {Database} from '../database';
import {openAIConnectionConfig} from '../openai/config';
import {openAIAccessToken} from '../openai/credentials';
import {providerConfig} from './generation';
import {anthropicProvider,openAIOAuthProvider,ProviderError,type FetchLike,type Provider} from './provider';

/** 작업 행에 고정된 provider와 회원 연결 revision에 따라 자격 증명을 선택한다. */
export function runtimeGenerationProvider(db:Database,fetchImpl:FetchLike=fetch):Provider{
 const anthropic=providerConfig();
 return async(input,context)=>{
  if(!context)throw new ProviderError('PROVIDER_CONTEXT_MISSING','생성 작업의 공급자 정보가 없습니다.',false);
  if(context.provider==='openai_oauth'){
   const config=openAIConnectionConfig();
   if(!config||!context.credentialRevision)throw new ProviderError('OPENAI_CONNECTION_REQUIRED','ChatGPT 계정을 다시 연결한 뒤 새 글 생성을 요청해주세요.',false);
   return openAIOAuthProvider({apiBase:config.apiBase,accessToken:()=>openAIAccessToken(db,context.ownerId,context.credentialRevision!,config,fetchImpl)},fetchImpl)(input,context);
  }
  if(context.provider==='anthropic'&&anthropic.apiKey)return anthropicProvider(anthropic,fetchImpl)(input,context);
  throw new ProviderError('PROVIDER_NOT_CONFIGURED','AI 글 생성 공급자가 설정되지 않았습니다.',false);
 };
}
