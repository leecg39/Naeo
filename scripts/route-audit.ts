/**
 * 83개 경로 감사: 실행 중인 서버에 비로그인·관리자로 요청해 접근 규칙을 확인하고,
 * 경로별 테스트·검증 기록과 함께 docs/fullstack/page-coverage.json을 다시 쓴다.
 * 사용: NAEO_AUDIT_EMAIL=… NAEO_AUDIT_PASSWORD=… [NAEO_AUDIT_BASE=http://127.0.0.1:3100] node --import tsx scripts/route-audit.ts
 */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';

type Access='public'|'guest'|'member'|'admin'|'dev'|'redirect';
/** to: 이동 경로의 기대 목적지(앞부분). */
type Rule={match:RegExp;tests:string[];sections:string[];access:Access;to?:string;external?:string};
const t=(...n:string[])=>n.map(x=>`tests/server/${x}.test.ts`);
const RULES:Rule[]=[
 {match:/^\/admin\/(events|event|rewards)$/,tests:t('events','events-http','event-pages'),sections:['P5.3–P5.6'],access:'admin'},
 {match:/^\/admin\/blog$/,tests:t('admin-articles','articles','content-http'),sections:['P2.2·P2.3'],access:'admin'},
 {match:/^\/admin\/inquiries/,tests:t('inquiries','inquiry-http'),sections:['P2.4'],access:'admin'},
 {match:/^\/admin\/keywords$/,tests:t('keywords','keywords-http','search-providers'),sections:['P3.5'],access:'admin',external:'검색광고 API 자격 증명(NAEO_SEARCHAD_*)·네이버 검색 API(NAEO_NAVER_*) 실제 왕복'},
 {match:/^\/admin\/scan-health$/,tests:t('scan-queue','scan-http'),sections:['P3.1'],access:'admin'},
 {match:/^\/admin\/users$/,tests:t('accounts','account-http'),sections:['P1 계정 보안'],access:'admin'},
 {match:/^\/admin\/writing$/,tests:t('writing-admin','generation-http'),sections:['P4.5'],access:'admin'},
 {match:/^\/admin$/,tests:t('foundation','account-http'),sections:['기반 구현'],access:'admin'},
 {match:/^\/auth\/extension$/,tests:t('oauth-server','mcp'),sections:['P7.2·P7.3'],access:'public',external:'Chrome Web Store 등록 확장 ID(NAEO_EXTENSION_IDS)와 배포 HTTPS 실환경 검증. 확장 본체·OAuth/MCP·네이버 편집기 전달은 로컬 검증 완료'},
 {match:/^\/auth\/google$/,tests:t('oauth'),sections:['P7.1'],access:'redirect',to:'/api/auth/oauth/google/start',external:'Google·네이버 앱 키(NAEO_GOOGLE_*/NAEO_NAVER_OAUTH_*)'},
 {match:/^\/blog/,tests:t('articles','blog-pages','article-seed','admin-articles'),sections:['P2.1','P2.2·P2.3'],access:'public'},
 {match:/^\/contact$/,tests:t('inquiries','inquiry-http'),sections:['P2.4'],access:'public'},
 {match:/^\/dashboard\/ai-picks$/,tests:t('ai-picks-page','analysis','citations','citations-http'),sections:['P3.3 AI 인용 확인','P3.4 무료 진단'],access:'member',external:'AI 인용 확인 SerpApi 키(NAEO_CITATION_PROVIDER·NAEO_SERPAPI_KEY) 실제 왕복'},
 {match:/^\/dashboard\/competitors$/,tests:t('competitors','competitors-http','competitors-page','action-items','search-providers'),sections:['P3.6'],access:'member',external:'네이버 검색 API(NAEO_NAVER_*) 실제 왕복'},
 {match:/^\/dashboard\/events/,tests:t('event-pages','events','events-http'),sections:['P5.3–P5.6'],access:'member'},
 {match:/^\/dashboard\/mate$/,tests:t('mate','mate-dashboard'),sections:['P3.4 무료 진단'],access:'member'},
 {match:/^\/dashboard\/recommendations$/,tests:t('recommendations-page','keywords'),sections:['P3.5'],access:'member'},
 {match:/^\/dashboard\/settings$/,tests:t('accounts','account-http','billing','oauth','oauth-server','notify-mail'),sections:['P1 계정 보안','P6','P7.1','P7.2·P7.3'],access:'member',external:'메일·SMS 인증(P1.6·P1.7) 실제 수신'},
 {match:/^\/dashboard\/write$/,tests:t('drafts','writing-http','generation','generation-http','media'),sections:['P4.4','P4.6'],access:'member',external:'AI 글: 승인된 OpenAI client(NAEO_OPENAI_*) 또는 ANTHROPIC_API_KEY 실제 왕복 · AI 이미지 NAEO_IMAGE_* 실제 키 왕복'},
 {match:/^\/dashboard$/,tests:t('dashboard-page','analysis','scan-queue','ranking'),sections:['P3.4 대시보드'],access:'member'},
 {match:/^\/dev\//,tests:[],sections:['P7.5'],access:'dev'},
 {match:/^\/event/,tests:t('event-pages','events','events-http'),sections:['P5.3–P5.6'],access:'public'},
 {match:/^\/faq$/,tests:t('faq'),sections:['P2.5 FAQ'],access:'public'},
 {match:/^\/(features|guide\/)/,tests:t('page-settings','seo'),sections:['P2.5 고정 디자인'],access:'public'},
 {match:/^\/images$/,tests:t('media','writing-http'),sections:['P4.4'],access:'public'},
 {match:/^\/login$/,tests:t('accounts','account-http','oauth'),sections:['P1 계정 보안','P7.1'],access:'guest'},
 {match:/^\/mate/,tests:t('mate'),sections:['P3.4 무료 진단'],access:'public'},
 {match:/^\/mcp$/,tests:t('mcp','oauth-server'),sections:['P7.2·P7.3'],access:'public'},
 {match:/^\/oauth\/consent$/,tests:t('oauth-server','mcp'),sections:['P7.2·P7.3'],access:'public'},
 {match:/^\/payment\/complete$/,tests:t('payments','billing-pages','billing-http'),sections:['P6'],access:'member',external:'토스페이먼츠 실제 키(NAEO_TOSS_*)'},
 {match:/^\/preview$/,tests:t('drafts','writing-http'),sections:['P7.5'],access:'redirect',to:'/dashboard/write'},
 {match:/^\/pricing$/,tests:t('billing-pages','billing','billing-http','payments'),sections:['P6'],access:'public',external:'토스페이먼츠 실제 키(NAEO_TOSS_*)'},
 {match:/^\/(privacy|terms|refund)/,tests:t('documents'),sections:['P2.5 정책 문서'],access:'public'},
 {match:/^\/ranking$/,tests:t('ranking','ranking-page','ranking-http'),sections:['P5.1·P5.2'],access:'public'},
 {match:/^\/social\/banner-preview/,tests:[],sections:['P7.4'],access:'redirect',to:'/'},
 {match:/^\/(social|youtube)\//,tests:t('creative','creative-http','exports','export-formats'),sections:['P7.4','P7.5'],access:'public'},
 {match:/^\/updates\/.+/,tests:t('updates'),sections:['P2.5 업데이트'],access:'redirect',to:'/updates?focus='},
 {match:/^\/updates$/,tests:t('updates'),sections:['P2.5 업데이트'],access:'public'},
 {match:/^\/p\//,tests:t('media','writing-http'),sections:['P4.1·P4.3'],access:'public'},
 {match:/^\/$/,tests:t('announcements','seo','mate'),sections:['P2.5 랜딩 공지'],access:'public'},
];
const SAMPLE:Record<string,string>={'/blog/:category/:slug':'/blog/guide/dashboard-guide','/dashboard/events/:slug':'/dashboard/events/naeo-review','/event/:slug':'/event/naeo-review','/p/:id/images':'/p/AAAAAAAAAAAAAAAAAAAAAA/images'};
const base=process.env.NAEO_AUDIT_BASE||'http://127.0.0.1:3100';
type Hit={status:number;location:string};
async function hit(path:string,cookie?:string):Promise<Hit>{
 const r=await fetch(base+path,{redirect:'manual',headers:cookie?{Cookie:cookie}:{}});
 const body=r.status===200?await r.text():'';
 if(/Application error|Internal Server Error/.test(body))return{status:500,location:''};
 return{status:r.status,location:(r.headers.get('location')||'').replace(base,'')};
}
const isLogin=(h:Hit)=>[302,303,307,308].includes(h.status)&&h.location.startsWith('/login');
/** 접근 규칙: 공개는 누구나 200, 회원·관리자는 비로그인이면 로그인으로, 개발 화면은 관리자만, 이동 경로는 비로그인도 이동. */
const moved=(h:Hit)=>[301,302,303,307,308].includes(h.status);
function judge(access:Access,anon:Hit,admin:Hit,to?:string):boolean{
 if(access==='public')return anon.status===200&&admin.status===200;
 if(access==='guest')return anon.status===200&&moved(admin);
 if(access==='member'||access==='admin')return isLogin(anon)&&admin.status===200;
 if(access==='dev')return anon.status===404&&admin.status===200;
 return moved(anon)&&(!to||anon.location===to||anon.location.startsWith(to==='/'?'/?':to)||(to==='/'&&anon.location==='/'));
}
async function main(){
 const email=process.env.NAEO_AUDIT_EMAIL,password=process.env.NAEO_AUDIT_PASSWORD;
 if(!email||!password)throw new Error('NAEO_AUDIT_EMAIL and NAEO_AUDIT_PASSWORD are required');
 const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({email,password})});
 if(!login.ok)throw new Error(`login failed: ${login.status}`);
 const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const file='docs/fullstack/page-coverage.json';
 const routes=JSON.parse(readFileSync(file,'utf8')) as {path:string;status:string;evidence:{type:string;[key:string]:unknown}[]}[];
 const at=new Date().toISOString();
 let failed=0,pendingExternal=0;
 const next=[];
 for(const r of routes){
  const rule=RULES.find(x=>x.match.test(r.path.replace(/:[a-z]+/g,'x')));
  if(!rule)throw new Error(`no audit rule for ${r.path}`);
  const url=SAMPLE[r.path]??r.path;
  const anon=await hit(url),admin=await hit(url,cookie);
  const ok=judge(rule.access,anon,admin,rule.to);
  const missing=rule.tests.filter(x=>!existsSync(x));
  if(missing.length)throw new Error(`missing test files for ${r.path}: ${missing.join(', ')}`);
  const status=!ok?'failed':rule.external?'external_pending':'verified';
  if(!ok)failed++;if(status==='external_pending')pendingExternal++;
  next.push({...r,status,evidence:[{type:'http',at,url,access:rule.access,anonymous:anon,admin,ok},{type:'tests',files:rule.tests},{type:'verification',sections:rule.sections},...(rule.external?[{type:'external_pending',reason:rule.external}]:[]),...r.evidence.filter(e=>!['http','tests','verification','external_pending'].includes(e.type))]});
 }
 const me=await fetch(`${base}/api/auth/me`,{headers:{Cookie:cookie}});
 writeFileSync(file,JSON.stringify(next,null,1)+'\n');
 process.stdout.write(`routes=${next.length} verified=${next.length-failed-pendingExternal} external_pending=${pendingExternal} failed=${failed} session_kept=${me.status===200}\n`);
 if(failed)process.exitCode=1;
}
main().catch(e=>{process.stderr.write(`[route-audit] ${e instanceof Error?e.message:String(e)}\n`);process.exitCode=1;});
