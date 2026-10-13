# API 계약

REA 확인 계약은 `rea-api-evidence.json`에 기록한다. 신규 API는 아래 규약을 따른다. 구현되지 않은 경로를 성공 처리하지 않는다.

## 공통

`application/json`, 쿠키 인증. 성공 `{data: ...}`, 목록 `{data: [...], pagination:{page,pageSize,total}}`. 오류 `{error:{code,message,details?},requestId}`. 400 입력 오류, 401 로그인 필요, 403 권한/Origin 위반, 404 부재/다른 소유자, 409 버전/중복/상태 충돌, 413 크기 초과, 415 형식 오류, 429 요청 제한, 503 외부 공급자 미설정. 응답은 no-store. REA 기존 응답 필드가 필요하면 기존 경로의 전용 어댑터에서 반환하며 클라이언트와 함께 검증한다.

PATCH/DELETE는 version을 요구한다. 계정 ID, role, 잔액은 클라이언트에서 신뢰하지 않는다. 검색·목록은 page≥1, pageSize 1–100. 상태 변경은 허용된 Origin 필수. read-only GET에 원장 차감 같은 암묵적 쓰기를 넣지 않는다. REA의 feedback refresh는 명시적 POST 작업 생성으로 UI를 전환한다.

| 단계 | 경로 | 메서드·입력·결과 |
|---|---|---|
| P1 | /api/health | GET 상태·스키마 버전, 비밀 경로 없음 |
| P1 | /api/auth/register | POST email,password(10–128),nickname(1–30), 약관 동의 → 계정+HttpOnly 세션 |
| P1 | /api/auth/login /logout /me | POST email/password, POST 로그아웃, GET 현재 계정 |
| P1 | /api/profile | GET 프로필, PATCH nickname/avatarUrl/rankingPublic/version |
| P1 | /api/blogs /api/blogs/:id | GET 목록·상세, POST naverId/title/category/isPrimary, PATCH 필드/version, DELETE version |
| P1 | /api/auth/password /sessions /account | 비밀번호 변경, 세션 목록·철회, 재인증 탈퇴. 재설정·메일 인증 별도 일회 토큰 |
| P1 | /api/contact-details /preferences | 본인 연락처·동의 CRUD, 실제 SMS 인증 시 phoneVerifiedAt 서버 설정 |
| P1 | /api/admin/users/:id | 관리자 목록/조회·정지/역할·탈퇴, 마지막 활성 관리자 보호·감사 |
| P2 | /api/content /articles /announcements | 공개 발행 콘텐츠 GET; 관리자 /api/admin/content, articles, categories, announcements CRUD |
| P2 | /api/inquiry /inquiries/:id | 문의 생성·소유자 RUD, 관리자 /api/admin/inquiries, /templates CRUD·답변 |
| P3 | /api/blog/rss-posts /save-url /feedback | REA 입력 계약 유지, 서버 소유권 확인, 수집·작업·분석 결과 전용 응답 |
| P3 | /api/scans /scans/:id /scans/:id/retry | 생성·상태·결과·취소·재시도, 관리 health |
| P3 | /api/recommendations /saved-keywords /competitors /actions | 검색·필터 및 각 소유 자원 CRUD, 관리자 키워드·지표 CRUD |
| P4 | /api/drafts /drafts/:id /drafts/:id/revisions | 초안 CRUD·버전·복원, 소유권 및 수정 충돌 |
| P4 | /api/write/tokens /generate /jobs/:id | 토큰 조회, 멱등 키로 생성 잡, 상태/취소, 공급자 오류·실패 환급 |
| P4 | /api/media /media/:id /shares | 파일 업로드·다운로드·삭제, 공유 생성/철회, signed expiry |
| P5 | /api/ranking 및 REA 하위 경로 /api/champions | 기간·카테고리·순위·변화·히스토리·분포 조회; 관리자 스냅샷 관리 |
| P5 | /api/events /events/:slug /entries/:id | 공개 이벤트 조회, 본인 참여 CRUD·증빙, 관리자 심사·보상 |
| P6 | /api/payment/start-trial /subscribe /payple-return | REA 소비 필드 호환; 서버 검증·멱등·상태 처리 |
| P6 | /api/subscriptions /coupons/redeem /refunds | 본인 플랜·해지·쿠폰·환불 요청, 관리자 상품/쿠폰/환불/원장 |
| P7 | /api/auth/naver/login /api/auth/google/login /callback | OAuth 시작·콜백, state/PKCE, 안전한 next |
| P7 | /api/oauth/authorize /token /revoke /api/mcp | 동의·교환·철회와 표준 MCP 전송·도구·권한 |
| P7 | /api/creative-projects /slides /exports | 제작 프로젝트·슬라이드 CRUD·순서·출력 잡·실제 파일 |
| P8 | /api/track /track/dwell /api/admin/metrics | 방문·체류·집계, 익명 식별자·입력 제한·보존 정책 |

각 단계에서 필드별 Zod 스키마와 HTTP 테스트를 구현해 이 계약을 구체화한다. 위 목록은 API 구현 완료 선언이 아니다.
