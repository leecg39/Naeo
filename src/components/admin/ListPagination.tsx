'use client';
import {useRef} from 'react';
export default function ListPagination({pagination,busy,onPage,label='목록 페이지'}:{pagination:{page:number;pageSize:number;total:number};busy:boolean;label?:string;onPage:(page:number)=>void}){
 const status=useRef<HTMLSpanElement>(null);
 const pages=Math.max(1,Math.ceil(pagination.total/pagination.pageSize));
 const changePage=(page:number)=>{
  // 요청 중 버튼이 disabled가 되어도 키보드 포커스는 페이지 컨트롤에 남긴다.
  // 응답을 기다린 뒤 이동하지 않아 사용자가 다른 곳으로 옮긴 포커스를 빼앗지 않는다.
  status.current?.focus({preventScroll:true});
  onPage(page);
 };
 return <nav aria-label={label} className="account-actions" style={{marginTop:20}}>
  <button type="button" className="button secondary" disabled={busy||pagination.page<=1} onClick={()=>changePage(pagination.page-1)}>이전</button>
  <span ref={status} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true"><span className="sr-only">{label}: </span>{pagination.page} / {pages}<span className="sr-only"> 페이지{busy?' · 불러오는 중':''}</span></span>
  <button type="button" className="button secondary" disabled={busy||pagination.page>=pages} onClick={()=>changePage(pagination.page+1)}>다음</button>
 </nav>;
}
