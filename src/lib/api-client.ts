'use client';

export class ApiError extends Error {
  constructor(message:string,public code:string,public status:number,public details?:unknown) {super(message);}
}
export async function apiResponse<T>(path:string,options:{method?:string;body?:unknown}={}):Promise<T> {
  const response=await fetch(path,{method:options.method||'GET',credentials:'same-origin',cache:'no-store',...(options.body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(options.body)}:{})});
  const result=await response.json();
  if(!response.ok) throw new ApiError(result.error?.message||'요청을 처리하지 못했습니다.',result.error?.code||'UNKNOWN',response.status,result.error?.details);
  return result as T;
}
export async function api<T>(path:string,options:{method?:string;body?:unknown}={}):Promise<T> {
  return (await apiResponse<{data:T}>(path,options)).data;
}
export {safeNext} from './safe-next';
export type PageResult<T>={data:T[];pagination:{page:number;pageSize:number;total:number}};
