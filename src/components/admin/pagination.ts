type Paged={pagination:{page:number;pageSize:number;total:number}};
/** 마지막 페이지 축소를 복구한다. 재조회 중에도 삭제되면 항상 유효한 첫 페이지로 돌아간다. */
export async function loadValidPage<T extends Paged>(fetchPage:(page:number)=>Promise<T>,page:number):Promise<T>{
 const result=await fetchPage(page);
 const last=Math.max(1,Math.ceil(result.pagination.total/result.pagination.pageSize));
 if(result.pagination.page<=last)return result;
 const recovered=await fetchPage(last);
 const latestLast=Math.max(1,Math.ceil(recovered.pagination.total/recovered.pagination.pageSize));
 // 무제한 재시도 대신 최대 세 번 조회한다. 첫 페이지는 전체 삭제 후에도 유효하다.
 return recovered.pagination.page>latestLast?fetchPage(1):recovered;
}
