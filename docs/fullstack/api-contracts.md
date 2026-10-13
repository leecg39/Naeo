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

## P1 계정·관리 구현 계약 (2026-10-13)

| 경로 | 실제 메서드·필드 |
|---|---|
| `/api/auth/terms` | POST `termsAccepted:true`; 최초 동의 시각·이력 저장. 관리자가 대신 동의할 수 없음 |
| `/api/auth/password` | PATCH `currentPassword,newPassword`; 전체 세션 종료 후 현재 요청에 새 세션 쿠키 발급 |
| `/api/auth/sessions` | GET 본인 유효 세션의 공개 ID·생성/만료·현재 여부, DELETE 현재 세션 외 모두 종료 |
| `/api/auth/sessions/:id` | DELETE 본인 세션만 철회. 현재 세션이면 쿠키 삭제; 세션 토큰/해시 미노출 |
| `/api/auth/account` | DELETE `currentPassword,confirmEmail,version`; 재인증·마지막 관리자 보호·개인 자원 cascade·쿠키 삭제 |
| `/api/contact-details` | GET (없으면 null), POST `name,email,phone`, PATCH 같은 필드+`version`, DELETE `version` |
| `/api/preferences` | GET, PATCH `marketingEmail,scanEmail,autoscan` 중 변경 필드+`version`; 선택 동의 변경 이력 저장 |
| `/api/admin/users` | GET `q,role,status,page,pageSize`, POST `email,nickname,password,role,currentPassword`; 신규 계정은 약관 미동의·메일 미인증 |
| `/api/admin/users/:id` | GET 상세, PATCH `nickname,role,status` 중 변경 필드+`version,currentPassword`, DELETE `confirmEmail,version,currentPassword` |
| `/api/admin/audit` | GET `q,page,pageSize`; 작업명 검색, 개인정보·비밀번호·토큰을 payload에 기록하지 않음 |

약관 미동의 계정은 동의·탈퇴·비밀번호·세션 관리만 가능하다. 관리자 권한/계정 정지를 바꾸면 대상 계정 세션을 모두 철회한다. 마지막 관리자 수에는 활성 상태이며 약관 동의를 마친 관리자만 포함한다. 관리자 쓰기·비밀번호 변경·탈퇴는 사용자별 15분 20회 제한이다. 프로필 닉네임 변경도 사용자 버전을 갱신해 관리자 편집과의 충돌을 감지한다.

연락처의 `phoneVerifiedAt`은 클라이언트에서 설정할 수 없으며 번호가 바뀌면 null로 초기화한다. SMS 공급자·이메일 발송·비밀번호 재설정·이메일 검증은 아직 구현하지 않았다. 동의/알림 설정 저장이 외부 발송 성공을 의미하지 않는다.

## P2.2 매거진 관리 API (2026-10-13)

모든 경로는 관리자 + 약관 동의 계정만 사용할 수 있다(일반 회원 403, 미인증 401). 쓰기 요청은 Origin 검사와 사용자별 15분 300회 제한을 적용한다. 기사 저장(`POST/PATCH /api/admin/articles…`, preview)만 요청 본문 1MB까지 받고, 나머지는 32KB 그대로다.

| 경로 | 메서드·필드 |
|---|---|
| `/api/admin/articles` | GET `q,status,category,page,pageSize`(모든 상태, 수정일 내림차순, LIKE 와일드카드 이스케이프). POST `categoryId,slug,title` 필수, `summary,showSummary,bodyMarkdown,tags[],coverImage,featured,status,publishedAt(ISO),readMinutes,position` 선택 |
| `/api/admin/articles/:id` | GET 상세 + `revisions[]`. PATCH 바뀐 필드만 + `version`. DELETE `version` |
| `/api/admin/articles/:id/restore` | POST `revision,version`: 지난 버전의 내용(분류·주소·제목·요약·본문·태그·표지·읽는 시간)을 새 버전으로 되돌린다. 공개 상태·게시일·추천·순서는 유지 |
| `/api/admin/articles/preview` | POST `bodyMarkdown` → `headings,warnings,readMinutes`(저장 안 함) |
| `/api/admin/article-categories` | GET 목록(공개·전체 글 수). POST `slug,name,sortOrder` |
| `/api/admin/article-categories/:id` | PATCH `slug,name,sortOrder`+`version`. DELETE `version`. 글이 있으면 409 `CATEGORY_IN_USE` |

규칙: 같은 분류 안의 주소 중복은 409 `SLUG_EXISTS`, 오래된 version으로 수정하면 409 `VERSION_CONFLICT`. 본문에 차단된 주소·지원하지 않는 구성 요소·HTML이 있으면 400 `CONTENT_INVALID`이며 `details`에 경고 목록을 담는다. `published`로 바꿀 때 게시일이 없으면 현재 시각을 넣는다. 미래 게시일은 예약 공개로 그 시각 전에는 404다. 본문이 바뀌면 읽는 시간을 다시 계산한다(새 규칙: 공백 제외 약 180자 = 1분, 원본 공식 미확인, 직접 입력 가능). 저장할 때마다 이전·새 버전 스냅샷을 `content_revisions`에 남기고, 감사 로그에 `content.article.*`·`content.category.*`를 기록한다. 분류를 바꾸면 공개 주소가 `/blog/새분류/주소`로 바뀐다.
