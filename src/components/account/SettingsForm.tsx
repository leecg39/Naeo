'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Profile } from '@/server/profiles';
import type { Blog } from '@/server/blogs';
import { api, ApiError } from '@/lib/api-client';

export default function SettingsForm({initialProfile,initialBlogs,email}:{initialProfile:Profile;initialBlogs:Blog[];email:string}) {
  const router=useRouter();
  const [profile,setProfile]=useState(initialProfile),[blogs,setBlogs]=useState(initialBlogs);
  const [editing,setEditing]=useState<Blog|null>(null),[confirming,setConfirming]=useState<Blog|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [formKey,setFormKey]=useState(0);
  async function run(action:()=>Promise<void>) {
    setBusy(true);setError('');setNotice('');
    try {await action();}
    catch(error) {setError(error instanceof Error?error.message:'저장하지 못했습니다.');if(error instanceof ApiError&&error.status===401)router.push('/login?next=/dashboard/settings');}
    finally {setBusy(false);}
  }
  async function refreshBlogs() {setBlogs(await api<Blog[]>('/api/blogs?pageSize=100'));router.refresh();}
  async function saveProfile(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const fields=new FormData(event.currentTarget);
    await run(async()=>{
      setProfile(await api<Profile>('/api/profile',{method:'PATCH',body:{nickname:fields.get('nickname'),rankingPublic:fields.get('rankingPublic')==='on',version:profile.version}}));
      setNotice('프로필을 저장했습니다.');router.refresh();
    });
  }
  async function saveBlog(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const fields=new FormData(event.currentTarget);
    await run(async()=>{
      const values={naverId:fields.get('naverId'),title:fields.get('title'),category:fields.get('category'),isPrimary:fields.get('isPrimary')==='on'};
      await api(editing?`/api/blogs/${editing.id}`:'/api/blogs',{method:editing?'PATCH':'POST',body:{...values,...(editing?{version:editing.version}:{})}});
      await refreshBlogs();setEditing(null);setFormKey(k=>k+1);setNotice('블로그를 저장했습니다.');
    });
  }
  return <div className="settings-sections">
    <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<div role="alert" className="account-error">{error} <button type="button" disabled={busy} className="button secondary" onClick={()=>void run(async()=>{setProfile(await api<Profile>('/api/profile'));await refreshBlogs();setEditing(null);setFormKey(k=>k+1);setNotice('최신 정보를 불러왔습니다.');})}>최신 정보 불러오기</button></div>}</div>
    <section className="panel account-card"><h2>내 프로필</h2><p className="muted">로그인 계정: {email}</p>
      <form onSubmit={saveProfile} key={profile.version} className="account-form">
        <label>닉네임<input name="nickname" className="field" defaultValue={profile.nickname} required maxLength={30} disabled={busy}/></label>
        <label className="account-checkbox"><input name="rankingPublic" type="checkbox" defaultChecked={profile.rankingPublic} disabled={busy}/><span>랭킹에 내 프로필 공개</span></label>
        <button className="button" type="submit" disabled={busy}>프로필 저장</button>
      </form>
    </section>
    <section className="panel account-card"><h2>내 블로그</h2><p className="muted">등록한 블로그를 관리하고 대표 블로그를 선택하세요.</p>
      {blogs.length===0?<p className="empty-state">등록한 블로그가 없습니다. 아래에서 첫 블로그를 추가하세요.</p>:<ul className="account-blog-list">{blogs.map(blog=><li key={blog.id}>
        <div><strong>{blog.title}</strong> {blog.isPrimary&&<span className="pill">대표</span>}<a className="muted" href={`https://blog.naver.com/${blog.naverId}`} target="_blank" rel="noreferrer">blog.naver.com/{blog.naverId} ↗</a>{blog.category&&<small>{blog.category}</small>}</div>
        <div><button type="button" className="button secondary" disabled={busy} onClick={()=>{setEditing(blog);setConfirming(null);setFormKey(k=>k+1);}}>수정<span className="sr-only"> {blog.title}</span></button><button type="button" className="button secondary" disabled={busy} onClick={()=>setConfirming(blog)}>삭제<span className="sr-only"> {blog.title}</span></button></div>
      </li>)}</ul>}
      {confirming&&<div className="account-delete" role="alert"><p>“{confirming.title}” 블로그를 삭제하시겠어요?</p><button type="button" className="button secondary" disabled={busy} onClick={()=>setConfirming(null)}>취소</button> <button type="button" className="button" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/blogs/${confirming.id}`,{method:'DELETE',body:{version:confirming.version}});await refreshBlogs();if(editing?.id===confirming.id){setEditing(null);setFormKey(k=>k+1);}setConfirming(null);setNotice('블로그를 삭제했습니다.');})}>삭제 확인</button></div>}
      <h3>{editing?'블로그 수정':'블로그 추가'}</h3>
      <form key={formKey} onSubmit={saveBlog} className="account-form">
        <label>네이버 블로그 ID<input className="field" name="naverId" placeholder="my_blog" defaultValue={editing?.naverId||''} pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}" maxLength={50} required disabled={busy}/></label>
        <label>블로그 이름<input className="field" name="title" defaultValue={editing?.title||''} maxLength={120} required disabled={busy}/></label>
        <label>주제<input className="field" name="category" defaultValue={editing?.category||''} maxLength={50} placeholder="예: 일상·생각" disabled={busy}/></label>
        <label className="account-checkbox"><input type="checkbox" name="isPrimary" defaultChecked={editing?.isPrimary??blogs.length===0} disabled={busy}/><span>대표 블로그로 설정</span></label>
        <div className="account-actions"><button className="button" type="submit" disabled={busy}>{editing?'블로그 수정 저장':'블로그 등록'}</button>{editing&&<button className="button secondary" type="button" disabled={busy} onClick={()=>{setEditing(null);setFormKey(k=>k+1);}}>수정 취소</button>}</div>
      </form>
    </section>
  </div>;
}
