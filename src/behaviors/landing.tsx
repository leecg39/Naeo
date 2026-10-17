"use client";

import { installHomeDemo } from "@/components/home/home-demo";
import type { InstallBehavior } from "@/lib/behavior";
import { text } from "@/lib/behavior";
import { api } from "@/lib/api-client";
import { parseNaverBlog } from "@/lib/naver-blog";
import MateReportView from "@/components/content/MateReportView";
import type { MateReport } from "@/server/mate/mate";

const CRITERIA = [
  ["독자·목적(누구에게)", "누구를 위해, 왜 쓴 글인지 분명하게 밝혀요", 3],
  ["직접 해본 과정·팁", "실제로 해보고 겪은 과정과 시행착오를 담아요", 7],
  ["비교·다른 선택지", "다른 선택지와 견줘 왜 이걸 골랐는지 알려줘요", 2],
  ["실제 결과·근거", "주장이 아니라 확인 가능한 근거를 보여줘요", 5],
  ["사진·표로 정리", "내용을 보기 좋게 사진과 표로 정리해요", 6],
] as const;
const GOOD = [
  ["실행 순서를 단계로 정리", "과정이 단계로 나뉘어 있으면 AI가 그대로 인용하기 쉬워요."],
  ["환급금·수익률을 실측 수치로 공개", "41만 원처럼 구체 수치가 문장의 근거가 돼요."],
  ["화면 캡처로 과정을 증명", "독자가 그대로 따라 할 수 있는 글이라는 신호가 돼요."],
  ["검색어와 제목을 일치", "'연말정산 미리보기'처럼 검색어가 제목에 그대로 있어요."],
];
const IMPROVE = [
  ["비교 표 추가", "수수료·조건을 표로 나란히 두면 ③ 기준이 바로 채워져요."],
  ["첫 문단에 독자 명시", "누구를 위한 글인지 첫 두 줄에서 밝혀 주세요."],
  ["결과를 표로도 정리", "본문에 흩어진 수치를 표 하나로 모으면 인용되기 쉬워요."],
  ["조건·주의사항 요약 박스", "적용 조건을 끝에 정리하면 근거가 한층 단단해져요."],
];

export const parseBlogId = parseNaverBlog;

export const installLanding: InstallBehavior = (root, tools) => {
  const cleanups: (() => void)[] = [];
  if(tools.pathname === "/"){const cleanup=installHomeDemo(root,tools);if(cleanup)cleanups.push(cleanup);}
  const attributeSnapshots = [...root.querySelectorAll("button,input")].map(el => ({el, attributes:["aria-pressed","aria-expanded","aria-current","aria-invalid","class"].map(name => [name,el.getAttribute(name)] as const)}));
  cleanups.push(() => attributeSnapshots.forEach(({el,attributes}) => attributes.forEach(([name,value]) => value===null?el.removeAttribute(name):el.setAttribute(name,value))));
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const animations = new Set<Animation>();
  const frames = new Set<number>();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let disposed = false;
  const later = (fn: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.delete(timer); if (!disposed) fn(); }, delay);
    timers.add(timer); return timer;
  };
  const on = (target: EventTarget, name: string, fn: EventListener, options?: AddEventListenerOptions) => {
    target.addEventListener(name, fn, options);
    cleanups.push(() => target.removeEventListener(name, fn, options));
  };
  const original = new Map<Element, string | null>();
  const saveStyle = (el: Element) => { if (!original.has(el)) original.set(el, el.getAttribute("style")); };
  const animate = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    saveStyle(el);
    if (typeof el.animate === "function") {
      const animation = el.animate(frames, { ...options, duration: reduced ? 0 : options.duration, fill: "forwards" });
      animations.add(animation);
    } else Object.assign((el as HTMLElement).style, frames[frames.length - 1]);
  };
  const observe = (el: Element, fn: () => void, threshold = 0, margin = "-50px") => {
    if (reduced || typeof IntersectionObserver === "undefined") { fn(); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { fn(); observer.disconnect(); }
    }, { threshold, rootMargin: margin });
    observer.observe(el); cleanups.push(() => observer.disconnect());
  };
  const add = <K extends keyof HTMLElementTagNameMap>(tag: K, content: string, parent: HTMLElement, css = "") => {
    const el = document.createElement(tag); el.textContent = content; el.style.cssText = css; parent.append(el); return el;
  };

  // 로그인하지 않았으면 /dashboard가 서버에서 로그인 화면으로 보낸다(세션 쿠키는 HttpOnly라 여기서 읽지 않는다).
  const showReport = (report: MateReport) => tools.openDialog("내 블로그 진단 리포트", <MateReportView report={report} onContinue={() => { tools.closeDialog(); tools.navigate(`/dashboard?blog=${encodeURIComponent(report.naverId)}`); }} />);
  const sharedToken = tools.pathname === "/mate/s" ? new URLSearchParams(window.location.search).get("r") : null;
  if (sharedToken && /^[A-Za-z0-9_-]{22}$/.test(sharedToken)) {
    api<MateReport>(`/api/mate/reports/${sharedToken}`).then(showReport).catch(error => tools.toast(error instanceof Error ? error.message : "리포트를 열지 못했습니다."));
  }
  const blogInputs = [...root.querySelectorAll<HTMLInputElement>('input[placeholder*="blog.naver.com"]')].filter(input=>!input.closest('[data-naeo-live]'));
  let pending = false;
  const runDiagnosis = (input?: HTMLInputElement) => {
    if (pending) return;
    const value = input?.value || blogInputs[0]?.value || "";
    const id = parseBlogId(value);
    if (!id) {
      blogInputs.forEach(el => el.setAttribute("aria-invalid", "true"));
      tools.toast(value.trim() ? "네이버 블로그 주소 또는 아이디를 입력해 주세요." : "먼저 진단할 네이버 블로그 주소 또는 아이디를 입력해 주세요.");
      (input || blogInputs[0])?.focus(); return;
    }
    pending = true;
    blogInputs.forEach(el => el.setAttribute("aria-invalid", "false"));
    tools.openDialog("블로그 진단", <div role="status" aria-live="polite"><p>{id} 블로그의 공개 글을 네이버 RSS에서 불러와 진단하고 있어요.</p><progress aria-label="진단 중" style={{width:"100%",accentColor:"#03c75a"}} /></div>);
    void (async () => {
      try {
        const report = await api<MateReport>("/api/mate/diagnose", { method: "POST", body: { blog: value } });
        if (!disposed) showReport(report);
      } catch (error) {
        if (disposed) return;
        tools.closeDialog();
        tools.toast(error instanceof Error ? error.message : "진단하지 못했습니다. 잠시 후 다시 시도해주세요.");
      } finally { pending = false; }
    })();
  };
  on(root, "input", event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !blogInputs.includes(input)) return;
    blogInputs.forEach(el => { if (el !== input) el.value = input.value; el.setAttribute("aria-invalid", "false"); });
  });
  on(root, "submit", event => {
    const form = event.target;
    if (form instanceof HTMLFormElement && !form.closest('[data-naeo-live]') && form.querySelector('input[placeholder*="blog.naver.com"]')) {
      event.preventDefault(); runDiagnosis(form.querySelector<HTMLInputElement>("input") || undefined);
    }
  });
  on(root, "keydown", event => {
    const key = event as KeyboardEvent;
    if (key.key === "Enter" && blogInputs.includes(key.target as HTMLInputElement) && !(key.target as HTMLInputElement).form) {
      event.preventDefault(); runDiagnosis(key.target as HTMLInputElement);
    }
  });

  const criteriaGroup = root.querySelector<HTMLElement>('[aria-label="네이버 공식 발표 5가지 기준"]');
  const criteriaButtons = [...root.querySelectorAll<HTMLButtonElement>('button[aria-label^="기준:"]')];
  const mobileDescriptions = criteriaGroup?.parentElement?.nextElementSibling as HTMLElement | null;
  const setCriterion = (index: number) => {
    criteriaButtons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
    if (mobileDescriptions) [...mobileDescriptions.children].forEach((el,i) => {
      saveStyle(el); (el as HTMLElement).style.transition = reduced ? "none" : "opacity 250ms ease-out";
      (el as HTMLElement).style.opacity = i === index ? "1" : "0";
    });
  };
  criteriaButtons.forEach((button, index) => {
    on(button, "pointerenter", () => setCriterion(index));
    on(button, "focus", () => setCriterion(index));
  });
  if (criteriaGroup) observe(criteriaGroup, () => {
    const paths = [...criteriaGroup.querySelectorAll<SVGPathElement>(":scope > svg > path")];
    paths.forEach((path,index) => {
      const delay = [2400,100,550][index] || 0;
      animate(path, [{opacity:0},{opacity:1}], {duration: index === 0 ? 500 : 350,delay:reduced ? 0 : delay,easing:"ease-out"});
      if (index === 2) { path.setAttribute("stroke-dasharray", "1 1"); animate(path,[{strokeDashoffset:1},{strokeDashoffset:0}],{duration:1750,delay:reduced?0:550,easing:"linear"}); }
    });
    criteriaButtons.forEach((button,index) => {
      [...button.querySelectorAll<HTMLElement>('[style*="opacity"]')].forEach(el => {
        const check = el.style.transform.includes("scale") || el.classList.contains("mui-ryjivn");
        animate(el,[{opacity:0,transform:check?"scale(.85)":"none"},{opacity:1,transform:"none"}],{duration:check?300:350,delay:reduced?0:check?550+350*index:100,easing:"ease-out"});
      });
      button.querySelectorAll<SVGPathElement>('path[stroke-dasharray]').forEach(path => {
        saveStyle(path); path.setAttribute("stroke-dasharray","1 1");
        animate(path,[{opacity:0,strokeDashoffset:1},{opacity:1,strokeDashoffset:0}],{duration:220,delay:reduced?0:670+350*index,easing:"ease-out"});
      });
    });
    later(() => setCriterion(0),reduced?0:2900);
  });

  // Hero text is captured before its source typewriter has populated the visible span.
  // Keep the separate screen-reader text and reproduce the observed 20ms character cadence.
  const heroHeading = root.querySelector<HTMLElement>("#landing-v2-main > section:first-child h1");
  const typewriter = heroHeading?.firstElementChild;
  const accessibleText = typewriter?.querySelector<HTMLElement>('span[style*="position"]');
  const visibleText = typewriter?.querySelector<HTMLElement>('span[aria-hidden="true"]');
  if (visibleText && accessibleText) {
    const previous=visibleText.textContent;
    const headingText=accessibleText.textContent||"내 블로그 포스팅";
    cleanups.push(()=>{visibleText.textContent=previous;});
    if(reduced)visibleText.textContent=headingText;
    else {
      visibleText.textContent="";
      for(let index=1;index<=headingText.length;index++)later(()=>{visibleText.textContent=headingText.slice(0,index);},20*index);
    }
    const cursor=visibleText.nextElementSibling as HTMLElement|null;
    if(cursor){
      saveStyle(cursor);
      if(reduced)cursor.style.display="none";
      else animate(cursor,[{opacity:0},{opacity:1},{opacity:0}],{duration:800,iterations:Infinity,easing:"linear"});
    }
  }
  heroHeading?.querySelectorAll<HTMLElement>('[style*="blur"]').forEach(el=>{
    animate(el,[{opacity:0,filter:"blur(10px)",transform:"scale(.95)"},{opacity:1,filter:"blur(0px)",transform:"scale(1)"}],{duration:500,delay:reduced?0:300,easing:"cubic-bezier(.22,1,.36,1)"});
  });

  // The source also has opacity-only entry states, not just translated elements.
  // Exclude state panels and the separately animated hero/criteria/carousel content.
  root.querySelectorAll<HTMLElement>('[style*="opacity"],[style*="filter"]').forEach(el => {
    if (el.closest("[data-naeo-home-demo]") || (el.closest("[data-naeo-home-mcp]") && !el.hasAttribute("data-naeo-home-mcp"))) return;
    if (criteriaGroup?.contains(el) || mobileDescriptions?.contains(el) || heroHeading?.contains(el) || el.closest('[aria-roledescription="carousel"],[hidden],template')) return;
    const hiddenOpacity=/^0(?:\.0+)?$/.test(el.style.opacity);
    const blurred=/blur\((?!0(?:px)?\))/.test(el.style.filter);
    if(!hiddenOpacity&&!blurred)return;
    observe(el, () => animate(el,
      [{opacity:hiddenOpacity?0:1,transform:el.style.transform||"none",filter:el.style.filter||"none"},
       {opacity:1,transform:"none",filter:blurred?el.style.filter.replace(/blur\([^)]*\)/g,"blur(0px)"):(el.style.filter||"none")}],
      {duration:400,easing:"cubic-bezier(.22,1,.36,1)"}));
  });
  root.querySelectorAll<HTMLElement>('[style*="translateY(110%)"]').forEach((el,index) => {
    observe(el, () => {
      // Analytic spring: original stiffness 300, damping 34, unit mass.
      const spring = Array.from({length:55},(_,step) => {
        const time=step/60;
        const displacement=Math.exp(-17*time)*(Math.cos(Math.sqrt(11)*time)+(17/Math.sqrt(11))*Math.sin(Math.sqrt(11)*time));
        return {transform:`translateY(${110*displacement}%)`};
      });
      spring[spring.length-1]={transform:"translateY(0)"};
      animate(el,spring,{duration:900,delay:reduced?0:[50,120,200][index%3],easing:"linear"});
      const number = [...el.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === "0");
      if (number) {
        const old=number.textContent;
        const isPeople=text(el).includes("매달"), target=isPeople?3000:1000;
        const start=performance.now()+(reduced?0:isPeople?500:650);
        const tick=(now:number) => {
          if(disposed)return;
          const progress=reduced?1:Math.min(1,Math.max(0,(now-start)/900));
          number.textContent=Math.round(target*(1-Math.pow(1-progress,3))).toLocaleString();
          if(progress<1){const frame=requestAnimationFrame(time=>{frames.delete(frame);tick(time);});frames.add(frame);}
        };
        tick(performance.now());cleanups.push(()=>{number.textContent=old;});
      }
    });
  });

  const carousel = root.querySelector<HTMLElement>('[aria-roledescription="carousel"]');
  const viewport = carousel?.firstElementChild as HTMLElement | null;
  const indicators = carousel ? [...carousel.querySelectorAll<HTMLButtonElement>('button[aria-label*="번째 카드"]')] : [];
  const labels = ["한눈 진단","공식 5가지 기준","잘하는 것과 바꿀 것"];
  let slideIndex = 0;
  let carouselVisible = false;
  let hovering = false;
  let rotation: ReturnType<typeof setTimeout> | undefined;
  const originalSlide = viewport?.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
  const carouselStatus = carousel?.lastElementChild?.querySelector<HTMLElement>("p");
  const carouselStatusText = carouselStatus?.textContent;
  cleanups.push(() => {if(carouselStatus)carouselStatus.textContent=carouselStatusText||"";});
  const fallbackSlide = (index: number) => {
    const wrapper = originalSlide?.cloneNode(true) as HTMLElement;
    wrapper.style.opacity = "1"; wrapper.style.transform = "none";
    wrapper.querySelectorAll<HTMLElement>('[style*="opacity"]').forEach(el => {el.style.opacity="1";el.style.transform="none";});
    if (!index) {
      const count = wrapper.querySelector(".mui-1lf31j")?.firstChild;
      if (count?.nodeType === Node.TEXT_NODE) count.textContent = "2";
      wrapper.querySelector<SVGCircleElement>('circle[stroke="url(#ringGrad)"]')?.setAttribute("stroke-dasharray","115.6106 289.0265");
      return wrapper;
    }
    const card = wrapper.querySelector<HTMLElement>(".MuiCard-root") || wrapper;
    card.replaceChildren(); card.style.color = "#17212e";
    add("span",labels[index],card,"font-size:12px;font-weight:700;color:#7b8592");
    add("h5",index===1?"네이버 공식 5가지 기준":"잘하는 것과 바꿀 것",card,"font-size:22px;font-weight:800;margin:4px 0 20px");
    if(index===1) [...CRITERIA].sort((a,b)=>b[2]-a[2]).forEach(([label,description,score]) => {
      const row = add("div","",card,"padding:12px 0;border-bottom:1px solid #e8ecef");
      add("strong",`${label}  ${score}/10`,row,"display:block;font-size:14px");
      const bar = add("div","",row,"height:5px;background:#edf2f0;border-radius:4px;margin:8px 0");
      add("div","",bar,`height:5px;width:${score*10}%;background:#03c75a;border-radius:4px`);
      add("p",description,row,"font-size:12px;line-height:1.5;color:#64748b;margin:0");
    });
    else [GOOD,IMPROVE].forEach((items,group) => {
      add("h6",group?"바꾸면 더 좋아요":"잘하고 있어요",card,`font-size:15px;font-weight:800;margin:${group?18:0}px 0 10px;color:${group?"#b7791f":"#008851"}`);
      items.forEach(([heading,copy]) => {
        const row = add("div","",card,"margin-bottom:8px"); add("strong",heading,row,"font-size:12px");add("p",copy,row,"font-size:11px;line-height:1.4;margin:2px 0;color:#64748b");
      });
    });
    return wrapper;
  };
  const scheduleRotation = () => {
    if (rotation) { clearTimeout(rotation); timers.delete(rotation); }
    if (!reduced && carouselVisible && !hovering) rotation = later(() => showSlide((slideIndex+1)%3),8000);
  };
  const showSlide = (index: number) => {
    if (!viewport || !originalSlide) return;
    const direction = index === (slideIndex+1)%3 ? 1 : -1;
    slideIndex = (index+3)%3;
    const template = root.querySelector<HTMLElement>(`[data-naeo-carousel-slide="${slideIndex}"]`);
    const source = template instanceof HTMLTemplateElement ? template.content.firstElementChild : template?.firstElementChild;
    const next = source?.cloneNode(true) as HTMLElement || fallbackSlide(slideIndex);
    next.style.opacity="1"; next.style.transform="none";
    viewport.replaceChildren(next);
    animate(next,[{opacity:0,transform:`translateX(${direction*60}px)`},{opacity:1,transform:"translateX(0)"}],{duration:220,easing:"ease-out"});
    indicators.forEach((button,i) => {button.setAttribute("aria-current",String(i===slideIndex));saveStyle(button);button.style.width=i===slideIndex?"22px":"8px";button.style.backgroundColor=i===slideIndex?"#03C75A":"rgba(255,255,255,.26)";});
    const status = carousel?.lastElementChild?.querySelector<HTMLElement>("p");
    if(status) status.textContent=`${slideIndex+1} / 3 · ${labels[slideIndex]}`;
    scheduleRotation();
  };
  if (carousel && viewport && originalSlide) {
    cleanups.push(() => viewport.replaceChildren(originalSlide));
    // The original carousel rotates only when 35% visible, and pauses on hover.
    const observer = new IntersectionObserver(entries => {carouselVisible=entries[0]?.isIntersecting||false;scheduleRotation();},{threshold:.35});
    observer.observe(carousel); cleanups.push(() => observer.disconnect());
    on(carousel,"pointerenter",()=>{hovering=true;scheduleRotation();});
    on(carousel,"pointerleave",()=>{hovering=false;scheduleRotation();});
    on(carousel,"keydown",event=>{const key=(event as KeyboardEvent).key;if(key==="ArrowLeft"||key==="ArrowRight"){event.preventDefault();showSlide(slideIndex+(key==="ArrowRight"?1:-1));}});
    let pointerX: number | null = null;
    on(viewport,"pointerdown",event=>{pointerX=(event as PointerEvent).clientX;});
    on(viewport,"pointerup",event=>{if(pointerX===null)return;const distance=(event as PointerEvent).clientX-pointerX;pointerX=null;if(Math.abs(distance)>60)showSlide(slideIndex+(distance<0?1:-1));});
    on(viewport,"pointercancel",()=>{pointerX=null;});
    observe(carousel,()=>showSlide(0),0,"0px 0px 120px 0px");
  }

  const detailNodes = new Map<string,HTMLElement>([...root.querySelectorAll<HTMLElement>('[id^="kw-reco-detail-"]')].map(el=>[el.id,el]));
  detailNodes.forEach(el=>{const hidden=el.hidden;cleanups.push(()=>{el.hidden=hidden;});});
  const toggleKeyword = (button: HTMLButtonElement) => {
    const id=button.getAttribute("aria-controls")!;
    const row=button.parentElement!;
    const opening=button.getAttribute("aria-expanded")!=="true";
    root.querySelectorAll<HTMLButtonElement>('button[aria-controls^="kw-reco-detail"]').forEach(el=>el.setAttribute("aria-expanded",String(opening&&el.getAttribute("aria-controls")===id)));
    detailNodes.forEach(node=>{node.hidden=true;});
    if(!opening)return;
    let panel=detailNodes.get(id);
    if(!panel) {
      panel=document.createElement("div");panel.id=id;panel.style.cssText="border-top:1px solid rgba(255,255,255,.06);padding:16px 20px;background:rgba(255,255,255,.02);font-size:12px";
      const desktop=[...row.querySelectorAll<HTMLButtonElement>("button")].find(el=>el.classList.contains("mui-16n3ebd"))||button;
      const cells=[...desktop.children].map(cell=>text(cell));
      add("strong","지표 분해",panel,"display:block;font-size:13px;margin-bottom:12px");
      const grid=add("div","",panel,"display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px");
      const numbers=cells.slice(3,8);
      ["PC 검색량","모바일 검색량","문서수"].forEach((label,i)=>{
        const cell=add("div","",grid,"padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:8px");
        add("span",label,cell,"display:block;color:#a3a3a3;font-size:11px");add("strong",numbers[[0,1,3][i]]||"—",cell,"font-size:15px");
      });
      add("p",`포화도 ${numbers[4]||"—"} = 문서수 ${numbers[3]||"—"} ÷ 검색량 ${numbers[2]||"—"}`,panel,"margin:10px 0 0;color:#a3a3a3;line-height:1.7");
      if(id.endsWith("-0")) {
        add("strong","추천 이력",panel,"display:block;font-size:13px;margin:18px 0 8px");
        add("p","최초 추천일 2026-04-18 · 재추천 4회 · 검색량 9,600 → 18,000 (▲ 88%) · 문서수 4,900 → 7,560 (▲ 54%)",panel,"font-size:12px;line-height:1.7;margin:0;color:#a3a3a3");
        add("strong","연관 키워드",panel,"display:block;font-size:13px;margin:18px 0 8px");
        const related=add("div","",panel,"display:flex;flex-wrap:wrap;gap:6px");
        [["연말정산 환급금 조회","12,000"],["연말정산 공제 항목","8,300"],["월세 세액공제 조건","5,100"],["연말정산 부양가족 등록","3,700"],["중소기업 소득세 감면","2,400"]].forEach(([keyword,volume])=>add("span",`${keyword} · 월 ${volume}회`,related,"padding:4px 8px;border:1px solid rgba(255,255,255,.07);border-radius:8px;font-size:11px"));
        const columns=add("div","",panel,"display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:18px");
        [["검색 상위 블로그",["1위 · 연말정산 미리보기 화면 그대로 따라 하기", "2위 · 환급 늘리는 공제 순서, 신용카드 vs 체크카드", "3위 · 맞벌이 부부 공제 몰아주기 계산해봤다"]],["최근 뉴스",["국세청 연말정산 미리보기 서비스 개통","월세 세액공제 한도 상향, 적용 대상 확대","카드 소득공제, 사용처별 공제율 차이 정리"]]].forEach(([title,items])=>{
          const column=add("div","",columns);add("strong",title as string,column,"display:block;font-size:13px;margin-bottom:8px");
          (items as string[]).forEach(item=>add("div",item,column,"padding:7px 10px;margin-bottom:4px;border:1px solid rgba(255,255,255,.07);border-radius:8px;font-size:11px"));
        });
      }
      const action=add("a","이 키워드로 글쓰기 →",panel,"display:inline-block;margin-top:12px;color:#03c75a;font-weight:700");
      const keyword=cells[2]?.replace(/황금|상세|접기/g,"").trim()||"";action.href=`/dashboard/write?keyword=${encodeURIComponent(keyword)}`;
      row.append(panel);detailNodes.set(id,panel);cleanups.push(()=>panel?.remove());
    }
    panel.hidden=false;animate(panel,[{opacity:0},{opacity:1}],{duration:260,easing:"ease-out"});
  };
  const firstKeyword=root.querySelector<HTMLButtonElement>('button[aria-controls^="kw-reco-detail"]');
  const keywordSection=root.querySelector("#step-02");
  if(firstKeyword&&keywordSection&&window.matchMedia("(min-width:900px)").matches) observe(keywordSection,()=>{later(()=>{if(!detailNodes.size)toggleKeyword(firstKeyword);},reduced?0:450);},.25,"0px");

  on(root,"click",event=>{
    if(event.defaultPrevented)return;
    const target=event.target instanceof Element?event.target.closest<HTMLButtonElement>("button"):null;
    if(!target||!root.contains(target))return;
    const label=target.getAttribute("aria-label")||"";
    if(/^기준:/.test(label)){event.preventDefault();setCriterion(criteriaButtons.indexOf(target));return;}
    if(label==="이전 카드"||label==="다음 카드"){event.preventDefault();showSlide(slideIndex+(label==="다음 카드"?1:-1));return;}
    if(indicators.includes(target)){event.preventDefault();showSlide(indicators.indexOf(target));return;}
    if(target.getAttribute("aria-controls")?.startsWith("kw-reco-detail")){event.preventDefault();toggleKeyword(target);return;}
    if(/^(블로그 확인하기|내 점수 보기)/.test(text(target))){event.preventDefault();runDiagnosis();return;}
    if(/^(무료로 확인하기|내 글도 인용됐는지 확인하기)/.test(text(target))){event.preventDefault();if(tools.pathname==="/mate")runDiagnosis();else tools.navigate("/mate");return;}
    const group=target.closest('[aria-label="데모에서 볼 AI 선택"]');
    if(group){
      event.preventDefault();const selected=text(target);
      group.querySelectorAll<HTMLButtonElement>("button").forEach(el=>{const active=el===target;el.setAttribute("aria-pressed",String(active));saveStyle(el);el.style.backgroundColor=active?"rgba(3,199,90,.12)":"transparent";el.style.color=active?"#03c75a":"#a3a3a3";});
      const panel=group.parentElement;
      if(panel){const walker=document.createTreeWalker(panel,NodeFilter.SHOW_TEXT);const nodes:Text[]=[];while(walker.nextNode())nodes.push(walker.currentNode as Text);nodes.forEach(node=>{if(!group.contains(node)&&/ChatGPT|Claude/.test(node.data)){const previous=node.data;cleanups.push(()=>{node.data=previous;});node.data=node.data.replace(/ChatGPT|Claude/g,selected);}});}
      return;
    }
    const imageGroup=target.closest(".MuiToggleButtonGroup-root");
    if(imageGroup&&/^[135]장$/.test(text(target))){
      event.preventDefault();imageGroup.querySelectorAll("button").forEach(el=>{const selected=el===target;el.classList.toggle("Mui-selected",selected);el.setAttribute("aria-pressed",String(selected));});
      const container=imageGroup.parentElement?.parentElement;
      const summary=container&&[...container.querySelectorAll<HTMLElement>("p,span")].find(el=>/총 \d장 예상/.test(text(el)));
      if(summary){const previous=summary.textContent;cleanups.push(()=>{summary.textContent=previous;});summary.textContent=text(summary).replace(/총 \d장 예상 = AI \d/,`총 ${target.value}장 예상 = AI ${target.value}`);}
      return;
    }
    if(text(target).startsWith("카테고리별 분포")){
      event.preventDefault();const opening=target.getAttribute("aria-expanded")!=="true";target.setAttribute("aria-expanded",String(opening));
      const container=target.parentElement;
      if(container)[...container.children].filter(el=>el!==target).forEach(el=>{saveStyle(el);(el as HTMLElement).style.display=opening?(el.classList.contains("mui-gaa5l0")?(window.innerWidth>=900?"grid":"none"):"flex"):"none";});return;
    }
    if(target.getAttribute("aria-controls")?.startsWith("ai-picks-detail")){
      event.preventDefault();tools.openDialog("AI 브리핑 인용 근거",<div><p style={{fontWeight:700,marginBottom:12}}>{label.replace(/ 상세 보기,.*$/,"")}</p><p>연말정산 미리보기 · 월 검색량 18,000 · 포화도 0.42</p><p style={{margin:"12px 0"}}>이미지 인용 2위 · 본문 인용 4회</p><p style={{color:"var(--muted)",fontSize:13}}>발행한 글의 화면 설명과 결과 수치가 답변의 근거로 사용되는 예시입니다.</p><a className="naeo-button" href="/dashboard/ai-picks" style={{marginTop:16}}>AI 인용 현황 보기</a></div>);return;
    }
    if(/^(\+ 2개 더 보기|접기)$/.test(text(target))&&target.classList.contains("mui-1b5k2p7")){
      event.preventDefault();
      const existing=target.parentElement?.previousElementSibling as HTMLElement|null;
      if(existing?.dataset.naeoMorePosts){existing.hidden=!existing.hidden;target.textContent=existing.hidden?"+ 2개 더 보기":"접기";return;}
      const extra=document.createElement("div");extra.dataset.naeoMorePosts="true";
      [["5.09 · 투자","IRP 1년 굴려본 기록, 원리금보장 vs ETF 수익률","퇴직연금 IRP 수익률 · 월 4,400 · 포화도 0.63 · 통합검색 노출"],["5.07 · 보험","실손보험 청구 앱으로 5분에 끝낸 후기","실손보험 청구 방법 · 월 3,300 · 포화도 0.87 · 미노출"]].forEach(([date,title,summary])=>{
        const row=add("div","",extra,"padding:16px 20px;border-top:1px solid rgba(255,255,255,.06)");add("span",date,row,"font-size:11px;color:#a3a3a3");add("p",title,row,"font-weight:700;font-size:13px;margin:5px 0");add("p",summary,row,"font-size:11px;color:#a3a3a3;margin:0");
      });
      target.parentElement?.before(extra);const previous=target.textContent;target.textContent="접기";cleanups.push(()=>{extra.remove();target.textContent=previous;});
    }
  });

  return () => {
    disposed=true;timers.forEach(clearTimeout);frames.forEach(cancelAnimationFrame);animations.forEach(animation=>animation.cancel());
    cleanups.reverse().forEach(cleanup=>cleanup());
    original.forEach((style,el)=>style===null?el.removeAttribute("style"):el.setAttribute("style",style));
  };
};
