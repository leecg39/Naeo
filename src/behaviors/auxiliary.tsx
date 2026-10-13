'use client';
import type { InstallBehavior } from '@/lib/behavior';
import { profile, readStore, writeStore, drafts } from '@/lib/demo-store';
import { useState } from 'react';
import LogoutButton from '@/components/account/LogoutButton';
function DraftList(){const entries=drafts();return <div>{entries.length?entries.map(d=><details key={d.id} className="naeo-panel" style={{marginBottom:12}}><summary>{d.title}</summary><p style={{whiteSpace:'pre-wrap',marginTop:16}}>{d.content}</p><a className="naeo-button" href={'/p/'+d.id+'/images'}>이미지 보기</a></details>):<p>저장된 글이 없습니다. AI 글쓰기에서 샘플 글을 만들어 저장해 보세요.</p>}<a className="naeo-button" href="/dashboard/write">AI 글쓰기</a></div>}
function LocalImageGallery(){const [files,setFiles]=useState<string[]>([]);return <div><p>이 브라우저에서 선택한 이미지만 표시합니다.</p><input type="file" multiple accept="image/*" onChange={e=>setFiles([...e.target.files||[]].map(f=>URL.createObjectURL(f)))}/><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:16}}>{files.map(src=><img alt="선택한 이미지" src={src} key={src}/>)}</div></div>}
export const installAuxiliary:InstallBehavior=(root,tools)=>{
 const timers:number[]=[];let observer:IntersectionObserver|undefined;
 const objectUrls:string[]=[];let photoGrid:HTMLDivElement|null=null;
 const onFileChange=(event:Event)=>{
  if(!/^\/(images|p\/)/.test(tools.pathname)||!(event.target instanceof HTMLInputElement)||event.target.type!=='file')return;
  photoGrid??=document.createElement('div');photoGrid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;max-width:960px;margin:24px auto;padding:16px';
  if(!photoGrid.isConnected)root.append(photoGrid);
  for(const file of [...event.target.files||[]].filter(f=>f.type.startsWith('image/'))){const src=URL.createObjectURL(file);objectUrls.push(src);const card=document.createElement('div'),img=document.createElement('img'),copy=document.createElement('button');img.src=src;img.alt=file.name;img.style.cssText='width:100%;height:160px;object-fit:contain';copy.className='naeo-button';copy.textContent='마크다운 복사';copy.onclick=()=>{void navigator.clipboard.writeText(`![${file.name}](${src})`).then(()=>tools.toast('이 브라우저에서 사용하는 이미지 주소를 복사했습니다.'))};card.append(img,copy);photoGrid.append(card);}
 };
 root.addEventListener('change',onFileChange);
 // Captured animation frames become live again without changing the source layout.
 if(tools.pathname!=='/'){observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const el=entry.target as HTMLElement;el.style.transition='opacity 400ms ease, transform 400ms ease';el.style.opacity='1';el.style.transform='none';observer?.unobserve(el)}},{threshold:.05});root.querySelectorAll<HTMLElement>('[style]').forEach(el=>{if(el.style.opacity==='0'&&/translate/.test(el.style.transform)&&!el.closest('[aria-hidden=true],.MuiCollapse-root'))observer?.observe(el)});timers.push(window.setTimeout(()=>observer?.disconnect(),90000));}
 const onClick=(e:MouseEvent)=>{if(e.defaultPrevented||!(e.target instanceof Element))return;const b=e.target.closest<HTMLElement>('button,[role=button]');if(!b)return;const label=b.getAttribute('aria-label')||'',text=b.textContent?.replace(/\s+/g,' ').trim()||'';
  if(label==='더보기 메뉴'||label==='MY 메뉴'||text==='NAEO 블로거'){e.preventDefault();tools.openDialog('내 계정',<div style={{display:'grid',gap:12}}><a className="naeo-button" href="/dashboard">대시보드</a><a className="naeo-button secondary" href="/dashboard/settings">계정 설정</a><button className="naeo-button secondary" onClick={()=>tools.openDialog('내 글 · 발행 대기함',<DraftList/>)}>내 글 · 발행 대기함</button><LogoutButton/></div>);return}
  if(tools.pathname==='/pricing'&&/구독|체험|요금제|결제/.test(text)){e.preventDefault();tools.openDialog('베이직 체험',<div><p>월 750토큰으로 AI 글쓰기와 분석 기능을 체험하세요.</p><p>이 로컬 데모에서는 카드 등록이나 결제가 발생하지 않습니다.</p><button className="naeo-button" onClick={()=>{writeStore('profile',{...profile(),plan:'basic'});tools.navigate('/dashboard/write')}}>데모 체험 시작하기</button></div>);return}
  if(/^\/(login|auth|oauth)/.test(tools.pathname)&&/네이버|Google|구글|로그인|허용|시작/.test(text)){e.preventDefault();tools.openAuth();return}
  if(/^\/(images|p\/)/.test(tools.pathname)&&/이미지|선택|업로드/.test(text)){if(root.querySelector('input[type=file]'))return;e.preventDefault();tools.openDialog('이미지',<LocalImageGallery/>);return}
  if(tools.pathname==='/preview'&&/다시|돌아|글|대시보드/.test(text)){e.preventDefault();tools.openDialog('내 글 · 발행 대기함',<DraftList/>);return}
 };
 root.addEventListener('click',onClick);
 // Public utility pages can read local drafts without talking to the original service.
 if(tools.pathname==='/preview'&&drafts().length){tools.openDialog('내 글 · 발행 대기함',<DraftList/>)}
 if(tools.pathname==='/dashboard/mate'){const diagnosis=readStore<unknown>('diagnosis',null);if(diagnosis){const link=root.querySelector<HTMLAnchorElement>('a[href="/mate"]');if(link)link.textContent='저장된 진단 다시 보기'}}
 return()=>{root.removeEventListener('click',onClick);root.removeEventListener('change',onFileChange);photoGrid?.remove();objectUrls.forEach(URL.revokeObjectURL);timers.forEach(clearTimeout);observer?.disconnect()};
};
