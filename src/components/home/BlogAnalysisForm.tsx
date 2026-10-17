'use client';

import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {api,ApiError} from '@/lib/api-client';
import {parseNaverBlog} from '@/lib/naver-blog';
import type {MateReport} from '@/server/mate/mate';
import SharedDialogs from '@/components/captured/SharedDialogs';
import MateReportView from '@/components/content/MateReportView';
import styles from './BlogAnalysisForm.module.css';

/** Live home entry point; does not depend on the captured page's delegated events. */
export default function BlogAnalysisForm(){
 const router=useRouter();
 const [blog,setBlog]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [report,setReport]=useState<MateReport|null>(null),[open,setOpen]=useState(false);
 const request=useRef<AbortController|null>(null),input=useRef<HTMLInputElement>(null);
 const close=useCallback(()=>setOpen(false),[]);
 useEffect(()=>()=>{request.current?.abort();request.current=null;},[]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(request.current)return;
  const id=parseNaverBlog(blog);
  setNotice('');setError('');
  if(!id){setError('네이버 블로그 주소 또는 아이디를 입력해 주세요. 예: leecg39');input.current?.focus();return;}
  const controller=new AbortController();request.current=controller;setBusy(true);
  try{
   const result=await api<MateReport>('/api/mate/diagnose',{method:'POST',body:{blog:id},signal:controller.signal});
   if(request.current!==controller)return;
   setReport(result);setOpen(true);setNotice(`${result.naverId}의 공개 글 ${result.postCount}개 분석을 완료했습니다.`);
  }catch(e){
   if(request.current!==controller||controller.signal.aborted)return;
   setError(e instanceof ApiError?e.message:'분석 서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
  }finally{
   if(request.current===controller){request.current=null;setBusy(false);}
  }
 }
 function cancel(){request.current?.abort();request.current=null;setBusy(false);setNotice('결과 대기를 취소했습니다. 이미 시작된 분석은 진단 기록에 남을 수 있습니다.');input.current?.focus();}
 const navigate=(href:string)=>{close();router.push(href);};
 return <div className={styles.root} data-naeo-live="home-analysis">
  <form onSubmit={submit} noValidate aria-label="블로그 분석" className={styles.form}>
   <label htmlFor="home-blog-address">네이버 블로그 주소 또는 아이디</label>
   <input ref={input} id="home-blog-address" name="blog" type="text" value={blog} onChange={e=>{setBlog(e.target.value);setError('');setNotice('');}}
    placeholder="blog.naver.com/아이디 또는 아이디" required maxLength={300} readOnly={busy} spellCheck={false} autoCapitalize="none" autoComplete="url"
    aria-invalid={!!error} aria-describedby={`home-analysis-hint${error?' home-analysis-error':''}`}/>
   <p id="home-analysis-hint" className={styles.hint}>로그인 없이 무료 · 공개 RSS 글의 발행·제목·태그·주제를 분석해요.</p>
   <button className={styles.submit} type="submit" disabled={busy}>{busy?'공개 글 분석 중…':error?'다시 분석하기':'블로그 분석하기'}</button>
  </form>
  {busy&&<div className={styles.progress}>
   <p role="status">네이버에서 공개 글을 불러와 5가지 지표를 계산하고 있어요.</p>
   <progress aria-label="공개 글 수집 및 분석 중"/>
   <button type="button" onClick={cancel}>대기 취소</button>
  </div>}
  {error&&<p id="home-analysis-error" role="alert" className={styles.error}>{error}</p>}
  <p role="status" aria-live="polite" className={styles.notice}>{notice}</p>
  {report&&!busy&&<button type="button" className={styles.reopen} onClick={()=>setOpen(true)}>{report.naverId} 분석 결과 다시 보기</button>}
  <SharedDialogs dialog={open&&report?{kind:'content',title:'블로그 분석 결과',wide:true,content:<MateReportView key={report.token} report={report} onContinue={()=>navigate(`/dashboard?blog=${encodeURIComponent(report.naverId)}`)}/>} : null}
   menuOpen={false} toast={null} onClose={close} onNavigate={navigate} onAuth={()=>navigate('/login')}/>
 </div>;
}
