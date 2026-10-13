import { readFileSync, writeFileSync } from 'node:fs';
const source = process.argv[2] || '../reverse-engineering/evidence';
const discovery = JSON.parse(readFileSync(`${source}/page-discovery/pages.json`, 'utf8'));
const domains = {
 public: ['P2', 'content_pages, content_revisions, announcements', '관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기', '관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409'],
 articles: ['P2', 'articles, article_categories, content_revisions', '기사/카테고리 CRUD·검색·발행/비공개·미리보기', '20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동'],
 events: ['P5', 'events, event_entries, reward_claims', '관리 이벤트 CRUD, 사용자 참가 CRUD, 심사·지급/취소', '기간/중복/소유권/심사 상태, 중복 보상 방지'],
 auth: ['P1/P7', 'users, sessions, oauth_accounts, oauth_grants, extension_tokens', '가입·로그인·정보 변경·탈퇴, 동의·발급/철회', '유지/만료/로그아웃, 비로그인 차단, OAuth state/PKCE'],
 analysis: ['P3', 'blogs, blog_posts, scan_jobs, scan_results, citations, action_items', '블로그 CRUD, 수집/분석 작업·취소/재시도, 결과 조회, 할 일 수정', '실제 수집 출처, 재시작/실패 복구, SSRF 차단, 계정 격리'],
 keywords: ['P3', 'keywords, keyword_metrics, recommendations, saved_keywords', '추천 조회/필터, 저장/완료/해제 CRUD, 관리 키워드 CRUD', '검색·필터·페이지 이동, 재로그인 보존, 권한·중복'],
 competitors: ['P3', 'competitors, blogs, scan_results', '추가·목록·메모 수정·삭제·비교', '중복 주소·한도·두 계정 격리·실제 결과 비교'],
 writing: ['P4', 'drafts, draft_revisions, generation_jobs, media_assets, share_links', '초안 CRUD·버전·생성·미디어 업로드/삭제·공유/철회·내보내기', '저장/재로그인/충돌/삭제, 생성 실패/취소, 파일 권한·실제 다운로드'],
 settings: ['P1/P6/P7', 'profiles, blogs, contact_details, notification_preferences, subscriptions, coupon_redemptions', '프로필/블로그/연락처/공개 설정 CRUD, 구독·쿠폰·탈퇴', '새 세션 보존, version, 권한·잔액 변경 차단, 실제 연락처 인증'],
 ranking: ['P5', 'ranking_periods, ranking_entries, champions', '공개 기간·주제·내 순위·히스토리, 관리자 스냅샷 CRUD', '동점·기간·공개 설정, 실제 측정 근거, 관리 반영'],
 contact: ['P2', 'inquiries, inquiry_messages, inquiry_templates', '문의 생성·본인 조회/수정/삭제, 관리자 답변·상태·템플릿 CRUD', '빈값/과다 요청, 계정 격리, 답변 후 수정 정책'],
 billing: ['P6', 'plans, subscriptions, payments, refunds, credit_ledger, coupons', '상품 관리·체험/구독/해지·쿠폰 CRUD·사용·환불', '금액/서명 검증, 중복 결제·차감 차단, 실제 샌드박스 왕복'],
 integrations: ['P7', 'oauth_clients, oauth_grants, api_tokens, mcp_calls', '클라이언트 등록·연결·토큰 조회/철회·MCP 도구 실행', '실제 클라이언트 연결, scope, 일회 코드·PKCE, 감사 기록'],
 creative: ['P7', 'creative_projects, creative_slides, export_jobs', '프로젝트/슬라이드 CRUD·정렬·복제·내보내기', '재접속 보존, 출력 파일 실제 열기, 소유권·공유·실패'],
 admin: ['P1–P8', 'users, audit_logs 및 메뉴 도메인 모델', '역할 제한 관리 목록·검색·상세·CRUD·감사', '일반 계정 403, 모든 관리 경로 직접 접근, 수정 공개 반영'],
 preview: ['P2/P7', 'content_revisions, creative_projects', '미리보기·임시 저장·공개 샘플', '미리보기는 공개 데이터를 변경하지 않음, 비공개 미노출'],
};
const admins = {
 '/admin': '운영 현황 및 콘텐츠·공지·FAQ·법적 문서 CRUD와 감사 로그',
 '/admin/blog': '기사·카테고리 CRUD, 발행·비공개, 공개 URL 미리보기',
 '/admin/event': '이벤트 편집기, 참가 조건·기간·보상 설정 CRUD',
 '/admin/events': '이벤트 목록·참가 심사·반려·보상 지급',
 '/admin/inquiries': '문의 검색·상세·상태·답변·삭제',
 '/admin/inquiries/templates': '답변 템플릿 CRUD와 문의에 적용',
 '/admin/keywords': '키워드·주제·검색 지표 CRUD, 출처·측정일 표시',
 '/admin/rewards': '쿠폰·보상 정책 CRUD·지급/철회, 원장 반대 분개',
 '/admin/scan-health': '작업 상태·실패 원인·재시도·취소·실행 로그',
 '/admin/users': '계정 검색·조회·역할/상태 변경·삭제, 마지막 관리자 보호',
 '/admin/writing': '생성 작업·작성 템플릿·비용 정책 CRUD, 실패 재시도',
};
const adminModels = {
 '/admin': ['P2/P8','content_pages, content_revisions, announcements, audit_logs, scan_jobs'],
 '/admin/blog': ['P2','articles, article_categories, content_revisions'],
 '/admin/event': ['P5','events, event_entries, reward_claims'],
 '/admin/events': ['P5','events, event_entries, reward_claims'],
 '/admin/inquiries': ['P2','inquiries, inquiry_messages'],
 '/admin/inquiries/templates': ['P2','inquiry_templates'],
 '/admin/keywords': ['P3','keywords, keyword_metrics, recommendations'],
 '/admin/rewards': ['P5/P6','reward_claims, coupons, coupon_redemptions, credit_ledger'],
 '/admin/scan-health': ['P3','scan_jobs, scan_results'],
 '/admin/users': ['P1','users, profiles, sessions, audit_logs'],
 '/admin/writing': ['P4','drafts, draft_revisions, generation_jobs, media_assets'],
};
function classify(p) {
 if (p.startsWith('/admin')) return 'admin';
 if (p === '/login' || p.startsWith('/auth/') || p === '/oauth/consent') return 'auth';
 if (p === '/dashboard/settings') return 'settings';
 if (p === '/contact') return 'contact';
 if (p === '/pricing' || p.startsWith('/payment/')) return 'billing';
 if (p === '/ranking') return 'ranking';
 if (p.startsWith('/dashboard/events') || p.startsWith('/event')) return 'events';
 if (p === '/dashboard/recommendations') return 'keywords';
 if (p === '/dashboard/competitors') return 'competitors';
 if (p === '/dashboard/write' || p === '/images' || p.startsWith('/p/')) return 'writing';
 if (['/dashboard','/dashboard/ai-picks','/dashboard/mate','/mate','/mate/s'].includes(p)) return 'analysis';
 if (p === '/mcp') return 'integrations';
 if (p.startsWith('/blog')) return 'articles';
 if (p.startsWith('/social/') || p.startsWith('/youtube/')) return 'creative';
 if (p.startsWith('/dev/') || p === '/preview') return 'preview';
 return 'public';
}
const rows = [...discovery.pages, ...discovery.dynamic_routes].map(({path}) => {
 const domain = classify(path);
 const [defaultPhase, defaultModels, operations, acceptance] = domains[domain];
 const [phase, models] = adminModels[path] || [defaultPhase,defaultModels];
 return {path, kind: path.includes(':') ? 'dynamic' : 'concrete', domain, phase, models: models.split(', '), operations: admins[path] || operations, acceptance, status: 'pending', evidence: []};
});
if (rows.length !== 83 || new Set(rows.map(r=>r.path)).size !== 83) throw Error('Expected 79 URLs and 4 unique dynamic routes');
writeFileSync('docs/fullstack/page-coverage.json', JSON.stringify(rows,null,2)+'\n');
writeFileSync('docs/fullstack/source-page-inventory.json', JSON.stringify({origin:discovery.origin,captured_at:discovery.captured_at,paths:discovery.pages.map(p=>p.path),dynamic:discovery.dynamic_routes},null,2)+'\n');
writeFileSync('docs/fullstack/rea-api-evidence.json', readFileSync(`${source}/static-api-inventory.json`));
writeFileSync('docs/fullstack/page-crud-matrix.md', [
 '# 전체 페이지 CRUD 계획', '',
 '원본 page.md의 구체 URL 79개와 동적 경로 4개를 모두 포함한다. 각 행은 DB·API·화면·권한·실행 증거를 함께 요구한다. 기존 화면 캡처는 백엔드 증거가 아니다. 모델과 관리자 UX는 REA에서 확인되지 않은 부분에 대한 신규 설계다.', '',
 '| 페이지 | 단계 | 데이터 모델 | CRUD·화면 | 수용 조건 |','|---|---|---|---|---|',
 ...rows.map(r=>`| \`${r.path}\` | ${r.phase} | ${r.models.join(', ')} | ${r.operations} | ${r.acceptance} |`), '',
 '공개 문서 수정은 관리자 편집기에서 수행한다. 금전 원장은 기록 자체를 임의 수정/삭제하지 않고 보정 거래로 취소한다. 개인정보 삭제와 회계 기록 보존을 분리한다. legacy 업데이트 경로는 308 리다이렉트와 글 위치를 함께 검증한다.',
].join('\n')+'\n');
console.log({concrete:discovery.pages.length,dynamic:discovery.dynamic_routes.length,coverage:rows.length});
