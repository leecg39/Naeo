type Paged={pagination:{page:number;pageSize:number;total:number}};
/** 삭제·검색으로 마지막 페이지가 줄었으면 한 번의 추가 조회로 유효한 마지막 페이지로 돌아간다. */
export async function loadValidPage<T extends Paged>(fetchPage:(page:number)=>Promise<T>,page:number):Promise<T>{
 const result=await fetchPage(page);
 const last=Math.max(1,Math.ceil(result.pagination.total/result.pagination.pageSize));
 return result.pagination.page>last?fetchPage(last):result;
}
