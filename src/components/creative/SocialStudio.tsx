'use client';
import {useState,type FormEvent} from 'react';
import {api,ApiError} from '@/lib/api-client';
import type {CreativeKind,Project,Slide} from '@/server/creative/projects';
import SlideEditor from './SlideEditor';

type Summary={id:string;kind:CreativeKind;title:string;slideCount:number;version:number;updatedAt:number};
const KIND:Record<CreativeKind,string>={carousel:'캐러셀(1080×1440)',ad:'광고(1080×1350)',video:'영상 장면(1920×1080)'};
const VIEW:Record<CreativeKind,string>={carousel:'/social/aeo-carousel',ad:'/social/mate-ad',video:'/youtube/aeo-intro'};
const base=(p:{id:string})=>`/api/creative/projects/${p.id}`;

export default function SocialStudio({initial}:{initial:Summary[]}){
 const [list,setList]=useState(initial),[project,setProject]=useState<Project|null>(null),[selected,setSelected]=useState<string|null>(null);
 const [form,setForm]=useState({kind:'carousel' as CreativeKind,title:''}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const reload=async(id?:string)=>{setList(await api<Summary[]>('/api/creative/projects'));if(id)setProject(await api<Project>(`/api/creative/projects/${id}`));};
 function run(action:()=>Promise<string>){setBusy(true);setError('');setNotice('');void action().then(setNotice).catch(e=>setError(e instanceof ApiError||e instanceof Error?e.message:'처리하지 못했어요.')).finally(()=>setBusy(false));}
 const open=(id:string)=>run(async()=>{const p=await api<Project>(`/api/creative/projects/${id}`);setProject(p);setSelected(p.slides[0]?.id??null);return '';});
 const create=(e:FormEvent)=>{e.preventDefault();run(async()=>{const p=await api<Project>('/api/creative/projects',{method:'POST',body:form});setForm({...form,title:''});await reload();setProject(p);setSelected(p.slides[0].id);return '프로젝트를 만들었어요.';});};
 const p=project,slide=p?.slides.find(s=>s.id===selected)??null;
 const act=(path:string,method:string,body:unknown,message:string,select?:(r:Slide)=>string)=>run(async()=>{const r=await api<Slide>(`${base(p!)}${path}`,{method,body});await reload(p!.id);if(select)setSelected(select(r));return message;});
 return <div className="settings-sections">
  <div aria-live="polite">{notice&&<p role="status" className="account-success">{notice}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>
  <section className="panel account-card" aria-label="내 프로젝트">
   <form className="admin-filters" onSubmit={create} aria-label="새 프로젝트">
    <label>종류<select className="field" value={form.kind} onChange={e=>setForm({...form,kind:e.target.value as CreativeKind})} disabled={busy}>{Object.entries(KIND).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label>제목<input className="field" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} maxLength={100} required disabled={busy}/></label>
    <button className="button" type="submit" disabled={busy}>새 프로젝트</button>
   </form>
   {list.length?<ul style={{listStyle:'none',padding:0,display:'grid',gap:8,marginTop:16}}>{list.map(x=><li key={x.id} className="account-actions" style={{justifyContent:'space-between'}}>
    <span><strong>{x.title}</strong> <span className="muted">· {KIND[x.kind]} · {x.slideCount}장</span></span>
    <span style={{display:'flex',gap:6,flexWrap:'wrap'}}><button className="button secondary" type="button" disabled={busy} onClick={()=>open(x.id)}>편집<span className="sr-only"> {x.title}</span></button>
     <button className="button secondary" type="button" disabled={busy} onClick={()=>run(async()=>{const c=await api<Project>(`/api/creative/projects/${x.id}/duplicate`,{method:'POST',body:{}});await reload();setProject(c);setSelected(c.slides[0].id);return '복사본을 만들었어요.';})}>복제<span className="sr-only"> {x.title}</span></button>
     <button className="button secondary" type="button" disabled={busy} onClick={()=>run(async()=>{await api(`/api/creative/projects/${x.id}`,{method:'DELETE',body:{version:x.version}});if(project?.id===x.id)setProject(null);await reload();return '프로젝트를 지웠어요.';})}>삭제<span className="sr-only"> {x.title}</span></button></span>
   </li>)}</ul>:<p className="muted" style={{marginTop:16}}>아직 프로젝트가 없어요.</p>}
  </section>
  {p&&<section className="panel account-card" aria-label="프로젝트 편집">
   <h2>{p.title} <span className="muted" style={{fontSize:14}}>· {KIND[p.kind]}</span></h2>
   <div className="account-actions" style={{flexWrap:'wrap'}}>
    {(['background','accent','text'] as const).map(k=><label key={k} style={{display:'flex',gap:6,alignItems:'center'}}>{k==='background'?'배경':k==='accent'?'강조':'글자'}<input type="color" value={p.theme[k]} disabled={busy} onChange={e=>{const theme={...p.theme,[k]:e.target.value.toLowerCase()};run(async()=>{await api(base(p),{method:'PATCH',body:{theme,version:p.version}});await reload(p.id);return '색을 바꿨어요.';});}}/></label>)}
    <a className="button secondary" href={`${VIEW[p.kind]}?project=${p.id}`}>보기</a>
    <a className="button secondary" href={`${VIEW[p.kind]}/export?project=${p.id}`}>내보내기</a>
   </div>
   <ol style={{listStyle:'none',padding:0,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:12}} aria-label="슬라이드 목록">{p.slides.map((s,i)=><li key={s.id} style={{display:'grid',gap:6}}>
    <button type="button" onClick={()=>setSelected(s.id)} aria-pressed={s.id===selected} aria-label={`슬라이드 ${i+1} 선택`} style={{padding:0,border:s.id===selected?'3px solid #03c75a':'1px solid #e5e5e5',borderRadius:8,background:'none',cursor:'pointer'}}>
     <img src={`${base(p)}/slides/${s.id}.svg?v=${s.version}-${p.version}-${i}`} alt={`슬라이드 ${i+1}: ${s.heading}`} style={{width:'100%',display:'block',borderRadius:6}}/></button>
    <span style={{display:'flex',gap:4,flexWrap:'wrap'}}>
     <button className="button secondary" type="button" disabled={busy||i===0} onClick={()=>act(`/slides/${s.id}/move`,'POST',{position:i-1},'앞으로 옮겼어요.')} aria-label={`슬라이드 ${i+1} 앞으로`}>↑</button>
     <button className="button secondary" type="button" disabled={busy||i===p.slides.length-1} onClick={()=>act(`/slides/${s.id}/move`,'POST',{position:i+1},'뒤로 옮겼어요.')} aria-label={`슬라이드 ${i+1} 뒤로`}>↓</button>
     <button className="button secondary" type="button" disabled={busy} onClick={()=>act(`/slides/${s.id}/duplicate`,'POST',{},'슬라이드를 복제했어요.',r=>r.id)} aria-label={`슬라이드 ${i+1} 복제`}>⧉</button>
     <button className="button secondary" type="button" disabled={busy||p.slides.length===1} onClick={()=>run(async()=>{await api(`${base(p)}/slides/${s.id}`,{method:'DELETE'});await reload(p.id);setSelected((p.slides[i-1]??p.slides[i+1])?.id??null);return '슬라이드를 지웠어요.';})} aria-label={`슬라이드 ${i+1} 삭제`}>✕</button>
    </span></li>)}</ol>
   <div className="account-actions"><button className="button secondary" type="button" disabled={busy} onClick={()=>act('/slides','POST',{heading:'새 슬라이드'},'슬라이드를 추가했어요.',r=>r.id)}>+ 슬라이드 추가</button></div>
   {slide&&<SlideEditor key={`${slide.id}:${slide.version}`} slide={slide} busy={busy} save={fields=>act(`/slides/${slide.id}`,'PATCH',{...fields,version:slide.version},'슬라이드를 저장했어요.')}/>}
  </section>}
 </div>;
}
