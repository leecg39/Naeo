'use client';
export default function ListPagination({pagination,busy,onPage}:{pagination:{page:number;pageSize:number;total:number};busy:boolean;onPage:(page:number)=>void}){
 const pages=Math.max(1,Math.ceil(pagination.total/pagination.pageSize));
 return <nav aria-label="목록 페이지" className="account-actions" style={{marginTop:20}}>
  <button type="button" className="button secondary" disabled={busy||pagination.page<=1} onClick={()=>onPage(pagination.page-1)}>이전</button>
  <span aria-live="polite">{pagination.page} / {pages}</span>
  <button type="button" className="button secondary" disabled={busy||pagination.page>=pages} onClick={()=>onPage(pagination.page+1)}>다음</button>
 </nav>;
}
