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

## P2.4 문의·답변 템플릿 API (2026-10-13)

`POST /api/inquiries`만 로그인 없이 쓸 수 있다(Origin 검사는 그대로). 접속 주소별 15분 30회, 회신 이메일별 1시간 5회로 제한한다. 비회원에게는 저장 내용 대신 `{received:true}`만 돌려준다. 약관에 동의한 회원이면 본인 문의로 묶고 문의 전체를 돌려준다. 회원이 탈퇴하면 그 회원의 문의와 답변도 함께 삭제된다.

| 경로 | 계약 |
|---|---|
| `/api/inquiries` | POST `type(service·technical·business·partnership·etc, 기본 etc),email,subject(≤200),message(1–5000)`. GET(회원) 본인 문의 `page,pageSize` |
| `/api/inquiries/:id` | 회원 본인만(남의 문의는 404). GET 문의 + `replies[]`(답한 관리자는 노출 안 함). PATCH `type,subject,message` + `version`: 상태가 `open`이고 답변이 없을 때만 가능, 아니면 409 `INQUIRY_LOCKED`. DELETE `version`(답변 여부와 관계없이 삭제, 답변도 함께 삭제). 쓰기는 회원별 15분 60회 |
| `/api/admin/inquiries` | 관리자. GET `q`(이메일·제목·내용, 와일드카드 이스케이프)`,status,type,page,pageSize`, 응답에 `ownerEmail` 포함 |
| `/api/admin/inquiries/:id` | GET 상세 + `replies[]`(`authorId,authorName,delivery`). PATCH `status(open·answered·closed),version`. DELETE `version` |
| `/api/admin/inquiries/:id/replies` | POST `body(1–10000),version`: 답변을 저장하고 `answered`·`answeredAt`으로 바꾼다. 메일 공급자가 없으므로 `delivery='not_configured'`로 기록하고 발송하지 않는다 |
| `/api/admin/inquiries/:id/replies/:replyId` | PATCH `body,version`, DELETE `version`. 답변을 바꿀 때도 문의 `version`을 올려 동시 수정을 409로 막는다 |
| `/api/admin/inquiry-templates` (`/:id`) | GET 목록(이름순), POST `name(1–60, 중복 409 TEMPLATE_EXISTS),subject,body`, PATCH 바뀐 필드 + `version`, DELETE `version` |

관리자 쓰기는 사용자별 15분 300회. 감사 로그(`inquiry.create/update/delete`, `admin.inquiry.status`, `admin.inquiry.reply.create/update/delete`, `admin.inquiry.delete`, `admin.inquiry_template.*`)에는 이메일·본문을 남기지 않는다.

## P2.5 정책 문서 API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/admin/documents` | GET | 관리자 | `q`(제목·주소, LIKE 이스케이프), `status`(draft/published), `page`, `pageSize≤100`. 순서 `position,path` | 401 비로그인, 403 일반 회원 |
| `/api/admin/documents` | POST | 관리자 | `path`(`/영문소문자-숫자`, 최대 3단계·80자), `title≤120`, `effectiveLabel≤120`, `body≤10만 자`, `closingNote≤2000`, `status`, `position`. 1MB까지 받음 | 400 검증, 409 `PATH_EXISTS`(같은 주소), 409 `PATH_RESERVED`(api·admin·dashboard·blog·updates 등 예약 경로, 다른 캡처 화면 주소) |
| `/api/admin/documents/:id` | GET | 관리자 | 문서 + 수정 이력(`revisions`) | 404 |
| `/api/admin/documents/:id` | PATCH | 관리자 | 바뀐 필드 + `version` | 409 `VERSION_CONFLICT`, 409 주소 충돌 |
| `/api/admin/documents/:id` | DELETE | 관리자 | `{version}`. 수정 이력도 삭제 | 409 버전 |
| `/api/admin/documents/:id/restore` | POST | 관리자 | `{revision,version}`. 내용(주소·제목·시행일·본문·맺음말)만 되돌리고 공개 상태·순서는 유지 | 404 `REVISION_NOT_FOUND` |

공개 화면: `/terms` `/privacy` `/privacy/extension` `/refund`와 관리자가 만든 문서 주소는 DB 공개본을 `/terms` 캡처 틀로 렌더링한다. 본문은 `## 소제목` 줄로 조항을 나누는 일반 텍스트이며 모든 글자를 텍스트 노드로만 넣는다(HTML 해석 없음). 초안·삭제된 문서는 404이고, 시드 문서 4개는 삭제 후에도 캡처 화면으로 되돌아가지 않는다. 시드는 `seed_runs('documents-v1')`로 한 번만 적용한다. 미리보기 `/admin/pages/preview/:id`는 관리자 전용.

## P2.5 FAQ API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/admin/faq` | GET | 관리자 | `q`(질문·답변·분류), `status`, `category`, `page`, `pageSize≤100`. 응답에 전체 분류 목록 `categories` | 401·403 |
| `/api/admin/faq` | POST | 관리자 | `category≤40`, `question≤200`, `answer≤5000`(빈 값 불가), `status`(draft/published), `position` | 400 검증 |
| `/api/admin/faq/:id` | PATCH | 관리자 | 바뀐 필드 + `version` | 404, 409 `VERSION_CONFLICT` |
| `/api/admin/faq/:id` | DELETE | 관리자 | `{version}` | 404, 409 |

공개 `/faq`는 공개 항목을 분류별(분류의 가장 앞 항목 순서) 접이식 목록으로 `/faq` 캡처 틀에 다시 그린다. 질문·답변은 텍스트 노드로만 넣는다. 시드 `faq-v1` 1회.

## P2.5 업데이트 소식 API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/admin/updates` | GET | 관리자 | `q`(제목·주소·버전·요약), `type`(feature/improvement/fix/design), `status`, `page`, `pageSize≤100`. 날짜 최신순·순서 | 401·403 |
| `/api/admin/updates` | POST | 관리자 | `slug`(영문 소문자·숫자·-), `versionLabel≤20`, `types`(1~4개, 중복 불가), `title≤200`, `summary≤500`, `bodyMarkdown`(매거진과 같은 안전 마크다운), `publishedOn`(YYYY-MM-DD), `status`, `position`. 1MB까지 | 400 검증·`CONTENT_INVALID`, 409 `SLUG_EXISTS` |
| `/api/admin/updates/:id` | GET·PATCH·DELETE | 관리자 | PATCH는 바뀐 필드 + `version`, DELETE는 `{version}` | 404, 409 |

공개 `/updates`는 공개 항목을 날짜 최신순·월별 묶음으로 캡처 틀에 다시 그리고, 필터 개수(새 기능·개선·버그 수정)를 DB에서 계산한다. `/updates/:slug`는 `/updates?focus=:slug`로 308, focus 항목은 펼쳐서 스크롤한다. '버그 수정' 칩은 캡처 예가 없어 '개선' 칩 모양을 쓴다(새 규칙). 시드 `updates-v1` 1회.

## P2.5 공지 API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/admin/announcements` | GET | 관리자 | `q`(제목·내용), `status`, `page`, `pageSize≤100`. 최근 수정순 | 401·403 |
| `/api/admin/announcements` | POST | 관리자 | `title≤80`, `body≤300`, `linkUrl`(빈 값·`/경로`(`//` 금지)·https), `linkLabel≤30`(링크가 있으면 필수), `target`(landing/all), `startsAt`·`endsAt`(ISO, 종료>시작), `status` | 400 |
| `/api/admin/announcements/:id` | PATCH·DELETE | 관리자 | 바뀐 필드 + `version`. 수정 후 전체 값으로 링크 문구·기간 규칙 재검사 | 400, 404, 409 |

공개: 공개 상태·기간·대상이 맞는 공지 중 가장 최근 수정된 1건을 화면 하단 고정 바로 표시한다(`/`는 landing·all, 다른 공개 화면은 all, 대시보드·관리자·로그인·결제·OAuth 경로는 표시 안 함). 방문자에게는 id·제목·내용·링크·version만 보낸다. 닫기는 방문자 브라우저에 `id:version`으로 기억하며 공지를 수정하면 다시 보인다. 원본 사이트에는 공지 영역이 없어 공지가 없으면 화면이 캡처와 같다(시드 없음).

## P2.5 고정 디자인 페이지 설정 API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/admin/page-settings` | GET | 관리자 | `/features` `/guide/writing` `/guide/extension-publish` 설정 목록 | 401·403 |
| `/api/admin/page-settings/:id` | GET·PATCH | 관리자 | PATCH `title≤120`, `description≤300`, `status`(published/hidden) + `version`. 주소 변경 불가 | 400, 404, 409 |
| `/api/admin/page-settings/:id/restore` | POST | 관리자 | `{revision,version}`. 제목·설명만 되돌리고 공개 여부 유지 | 404 |

이 세 페이지는 레이아웃이 디자인 자체라 본문은 캡처 그대로 두고, 생성·삭제 대신 숨김(404)을 쓴다. 제목은 `제목 | NAEO`로, 설명은 meta description으로 나간다(모든 DB 화면이 description을 내보내도록 메타데이터도 확장). 시드 `page-settings-v1`은 캡처 제목을 읽어 1회 적용.

## P2.6 robots·sitemap·RSS·llms.txt (2026-10-13)

| 경로 | 형식 | 규칙 |
|---|---|---|
| `/robots.txt` | text/plain | 기본 `Disallow: /`(복제 사이트가 원본 대신 검색되지 않도록). `NAEO_ALLOW_INDEXING=1`이면 공개 화면 허용, 관리자·API·대시보드·로그인·OAuth·결제·개발·소셜 내보내기 경로 차단, sitemap 주소 포함 |
| `/sitemap.xml` | application/xml | 공개 화면 12개 + 공개 고정 페이지 + 공개 정책 문서 + 게시된 매거진 글. 초안·예약·비공개·숨김·삭제, 예전 `/updates/:slug`, 대시보드·관리자 제외. lastModified는 DB 수정 시각 |
| `/rss.xml` | application/rss+xml | 매거진 최신 공개 글 20개(RSS 2.0, 절대 주소, XML 이스케이프·제어 문자 제거) |
| `/llms.txt` | text/plain | 안내·공개 고정 페이지·매거진(제목·요약)·정책 문서를 절대 주소 마크다운 링크로 색인. 소개 문구는 새로 작성 |

모두 요청마다 DB를 읽고(`dynamic='force-dynamic'`), RSS·llms는 `Cache-Control: no-cache`라 비공개 전환이 바로 반영된다.

## P3.1–P3.3 진단 작업·수집·분석 API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/scans` | POST | 회원(본인 블로그) | `{blogId,idempotencyKey?}`. 같은 키는 같은 작업 반환, 블로그당 진행 중 작업 1개(부분 unique index), 시간당 20회 | 404 `BLOG_NOT_FOUND`, 409 `SCAN_IN_PROGRESS`, 429 |
| `/api/scans` | GET | 회원 | `blogId`, `state`, `page`, `pageSize`. 본인 작업만 | 401 |
| `/api/scans/:id` | GET | 회원 | 상태·진행률·시도·오류·결과 요약. 작업자 id·임대 정보는 숨김 | 404 |
| `/api/scans/:id/cancel` | POST | 회원 | 대기 → 즉시 취소, 실행 중 → 취소 요청(작업자가 다음 진행 보고 때 중단, 늦게 온 결과보다 취소 우선) | 409 `SCAN_FINISHED` |
| `/api/scans/:id/retry` | POST | 회원 | 실패·취소 작업만 새 작업(`retryOf`)으로 | 409 `SCAN_NOT_RETRYABLE`·`SCAN_IN_PROGRESS` |
| `/api/blogs/:id/scan-results` · `/latest` | GET | 회원(본인 블로그) | 분석 이력(최신순)·최신 보고서 | 404 |
| `/api/admin/scan-health` | GET | 관리자 | 상태별 개수, 24시간 완료·실패, 가장 오래 기다린 작업, lease 만료 수, worker(30초 내 신호면 동작 중), 최근 실패 | 403 |
| `/api/admin/scans` · `/:id/cancel` · `/:id/retry` | GET·POST | 관리자 | 검색(이메일·블로그 ID·오류 코드)·상태 필터, 취소·재시도(감사 로그) | 403, 409 |

작업 큐: `scan_jobs`(queued→running→succeeded/failed/canceled). worker는 `npm run worker`(같은 DB, 여러 개 실행 가능). 임대 60초, 진행 보고 때 연장, 만료되면 다른 worker가 넘겨받음(시도 횟수 증가, 최대 3회 후 `LEASE_EXPIRED`). 재시도 가능한 오류는 30초·60초 지수 대기 후 재실행.

수집: 요청 주소는 `https://rss.blog.naver.com/{검증된 블로그 ID}.xml`만(사용자 URL 미사용으로 SSRF 차단), 리디렉션 거부, 10초 제한, 2MB 상한. 404·빈 채널은 `BLOG_NOT_FOUND`(재시도 안 함), 연결 실패·429·5xx는 `FETCH_FAILED`(재시도). 글은 `blog.naver.com/{id}/{글번호}`인 것만 정규 주소로 저장하고, 블로그·글 번호 기준으로 넣거나 갱신한다(수집 시각 보존, RSS에서 빠진 글은 유지).

분석(`rules-v1`, 새 규칙): 발행 빈도(최근 30일 12개 만점)·최근성(3일 이내 만점)·제목 구체성(15~45자 비율)·태그 활용(3개 이상 비율)·주제 일관성(최다 분류 60% 이상 만점) 각 20점. 근거 수치, 14점 미만 기준의 할 일, 새 규칙 고지를 보고서에 저장한다. AI 브리핑 인용 근거는 공식 API·공급자가 없어 `aiCitation.status='not_configured'`로 저장하고 지어내지 않는다.

## P3.4 무료 진단(메이트) API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/mate/diagnose` | POST | 공개(로그인 시 내 기록 연결) | `{blog}`: 블로그 ID 또는 `blog.naver.com`·`m.blog.naver.com` 주소만. RSS 즉시 수집·분석, 공유 토큰(22자) 발급, 30일 보관. 제한: IP 10분 5회, 블로그 시간당 10회, 전체 시간당 300회 | 400 `INVALID_BLOG`, 404 `BLOG_NOT_FOUND`, 502 `FETCH_FAILED`, 429 |
| `/api/mate/reports/:token` | GET | 공개(공유 링크) | 만료 전 리포트. 작성자 정보 없음 | 404 |
| `/api/mate/reports` | GET | 회원 | 내 진단 기록(만료 제외) | 401 |
| `/api/mate/reports/:token` | DELETE | 회원(작성자) | 삭제 후 공유 링크도 404 | 404 |

화면: `/mate`·`/mate/s` 입력은 실제 진단(예시 리포트·localStorage 제거), `/mate/s?r=토큰`은 공유 리포트 열기, `/dashboard/mate`는 내 기록 목록·삭제(없으면 빈 상태), `/dashboard/ai-picks`는 원본 계정 인용 목록·지표를 지우고 미설정 상태. 하루 진단 한도(회원 20회/KST)는 `/api/scans`에 적용.

## P3.5 키워드·지표·추천 API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/admin/keywords` | GET·POST | 관리자 | 검색(키워드·분류, LIKE 이스케이프)·상태·분류 필터·페이지. 생성 `phrase≤60`(대소문자 무시 unique), `category≤30`, `note≤200`, `status`(active/hidden) | 403, 409 `KEYWORD_EXISTS` |
| `/api/admin/keywords/:id` | GET·PATCH·DELETE | 관리자 | 상세는 지표 이력(최신순)·최신 지표. PATCH·DELETE는 `version` | 404, 409 |
| `/api/admin/keywords/:id/metrics` · `/:metricId` | POST·DELETE | 관리자 | PC·모바일 검색량·문서수(0 이상 정수), 측정 시각. 출처 `manual`(검색광고 API 미설정) | 400, 404 |
| `/api/recommendations` | GET | 회원 | 노출 키워드 + 최신 지표 + 내 상태. `filter`(all/golden/preempt/written), `period`(all/week/month), `q`, 페이지, 요약(전체·황금·선점·작성) | 401, 400 |
| `/api/recommendations/:keywordId/state` | PUT | 회원 | `{status:'written'|'saved'|null}` 작성 완료 표시·해제(회원별) | 404(숨김·없음) |

분류(새 규칙): 포화도 = 문서수 ÷ (PC+모바일 월 검색량). 황금 = 포화도 1 미만·검색량 1,000 이상, 선점기회 = 황금 아님·포화도 3 미만·검색량 300 이상. 지표가 없거나 검색량 0이면 분류하지 않는다. 화면 `/dashboard/recommendations`는 서버가 행·모바일 카드·요약을 DB로 그리고(캡처 계정 키워드 제거), 검색(`?q=`)·페이지(50개)는 서버, 황금·선점·기간 필터와 정렬은 화면에서 처리한다.

## P3.6 경쟁 블로그·오늘 할 일 API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/competitors` | GET·POST | 회원 | 목록은 내 경쟁 블로그 + 비교 기준(내 대표 블로그 최신 진단). 추가 `{blog,note≤500}`: 블로그 ID·네이버 블로그 주소만, 회원당 10개(새 규칙), 회원별 unique | 400 `INVALID_BLOG`, 409 `COMPETITOR_EXISTS`·`COMPETITOR_LIMIT` |
| `/api/competitors/:id` | PATCH·DELETE | 회원(본인) | 메모 수정 `{note,version}`, 삭제 `{version}` | 404, 409 |
| `/api/competitors/:id/refresh` | POST | 회원(본인) | 공개 RSS 수집 → 5가지 기준 스냅숏(점수·글 수·최근 글). 같은 블로그 10분 간격, 회원 시간당 30회. 실패 코드는 화면에 기록 | 404 `BLOG_NOT_FOUND`, 429 `REFRESH_TOO_SOON`, 502 |
| `/api/actions` | GET | 회원 | 최신 진단 결과의 할 일(진단 저장 때 결과·기준당 1개 생성) | 401 |
| `/api/actions/:id` | PATCH | 회원(본인) | `{status:'open'|'done',version}` 완료·해제 | 404, 409 |

`/dashboard/competitors`는 원본 계정의 키워드별 상위 노출 표(다른 블로그 글 제목)를 지우고 내 경쟁 블로그 표·추가 폼·내 점수 대비 차이를 보여준다. 키워드별 상위 노출 비교는 네이버 검색 API 미설정으로 표시. 운영 주의: worker는 코드 배포 뒤 다시 시작해야 새 로직(예: 할 일 생성)이 적용된다.

## P4.1·P4.3 초안·사진·공유 링크 API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/drafts` | GET·POST | 회원 | 목록: `q`(제목·키워드)·`status`·페이지, 본문 제외·사진 수 포함. 생성: `title≤200`, `keyword≤60`, `category≤30`, `body≤10만 자`(512KB 요청) | 400, 401 |
| `/api/drafts/:id` | GET·PATCH·DELETE | 회원(본인) | 상세는 수정 이력 포함. 상태 전이 draft→ready/archived, ready→draft/published/archived, published→archived, archived→draft. 본문 없으면 ready·published 불가. 삭제 시 사진은 내 사진함에 남고 공유 링크는 삭제 | 404, 409 `VERSION_CONFLICT`·`INVALID_TRANSITION`·`DRAFT_EMPTY` |
| `/api/drafts/:id/restore` | POST | 회원(본인) | `{revision,version}` 제목·본문만 되돌림 | 404 |
| `/api/media` | GET·POST | 회원 | 업로드는 multipart(`file`, `draftId?`). 형식은 파일 서명으로만 판정(JPG·PNG·WEBP), 10MB, 글당 20장·계정당 500장, 시간당 120회. 디스크에는 무작위 이름으로 저장(`NAEO_UPLOAD_DIR`, 기본 `var/uploads`) | 413, 415, 409 `TOO_MANY_IMAGES` |
| `/api/media/:publicId` | GET·PATCH·DELETE | 회원(본인) | 공개 id는 22자 무작위. 응답 `nosniff`·`CSP sandbox`·`private, no-store`. PATCH `{draftId|null}` 연결 변경, DELETE는 파일도 삭제 | 401, 404 |
| `/api/drafts/:id/shares` | GET·POST | 회원(본인) | 공유 링크 `{days:1~30}` | 404 |
| `/api/shares/:token` | GET(공개)·DELETE(본인) | — | 글 제목·사진 목록. DELETE는 철회 | 404 `SHARE_EXPIRED` |
| `/api/shares/:token/media/:publicId` | GET(공개) | — | 그 글에 연결된 사진만 | 404 |

## P4.2 토큰 원장·AI 글 생성 API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/credits` | GET | 회원 | 잔액(원장 합계)과 원장(지급·생성 차감·환급·조정) | 401 |
| `/api/admin/credits` | POST | 관리자 | `{userId,delta(±10만, 0 불가),note}` 지급·회수, 잔액이 음수가 되면 거절, 감사 기록 | 403, 409 `NEGATIVE_BALANCE` |
| `/api/generations` | GET·POST | 회원 | 요청 `{keyword≤60,category,title,experience≤1000,instructions≤1000,photoIds(내 사진, ≤20),aiImages,idempotencyKey}`. 공급자 키가 없으면 503(차감 없음), AI 이미지 요청은 503(이미지 공급자 미설정). 같은 키는 같은 작업(1회 차감), 잔액 부족 402. 작업 등록·10토큰 차감은 한 트랜잭션. 시간당 30회 | 400, 402 `INSUFFICIENT_TOKENS`, 404 `PHOTO_NOT_FOUND`, 503 `PROVIDER_NOT_CONFIGURED`·`IMAGE_PROVIDER_NOT_CONFIGURED` |
| `/api/generations/:id` · `/cancel` | GET·POST | 회원(본인) | 대기 작업 취소는 즉시 환급, 실행 중이면 결과 대신 취소·환급(초안 없음) | 404, 409 `GENERATION_FINISHED` |

worker(`npm run worker`)가 진단과 생성 작업을 함께 처리한다. 공급자: `ANTHROPIC_API_KEY`가 있을 때만 Anthropic Messages API(`NAEO_AI_MODEL`, 기본 `claude-sonnet-4-6`, 최대 4000토큰, 120초 제한). 사용자 입력은 사용자 메시지의 경계 태그 안에만 넣고 시스템 지시에는 넣지 않는다. 성공하면 초안 생성·사진 연결·작업 완료를 한 트랜잭션으로 처리, 실패(재시도 불가 또는 2회 초과)는 작업당 1회 환급(원장 유일 제약).

## P4.5 글쓰기 관리·내보내기 API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/drafts/:id/export` | GET | 회원(본인) | `format=html|markdown|text`, `download=1`이면 첨부. HTML은 안전 렌더러 노드를 허용 태그·속성만 직렬화(글자·속성 이스케이프, 스크립트·javascript: 제외), 응답 `CSP sandbox`·`no-store` | 400, 404 |
| `/api/writing-templates` | GET | 회원 | 노출 템플릿의 id·이름·주제(지침 본문은 서버에서만) | 401 |
| `/api/admin/writing-templates` · `/:id` | GET·POST·PATCH·DELETE | 관리자 | `name≤60`(대소문자 무시 unique), `category`, `guidance≤2000`, `status`, `version` | 403, 409 |
| `/api/admin/generations` · `/:id/cancel` | GET·POST | 관리자 | 전체 회원 생성 작업(이메일·키워드·오류 코드 검색, 상태 필터), 취소 시 대기 작업 즉시 환급·실행 중 취소 요청(감사) | 403, 409 |

생성 요청의 `templateId`는 요청 시점의 지침을 작업에 복사해 두고, 운영자 지침은 시스템 지시에, 회원 입력은 사용자 메시지 경계 태그 안에만 넣는다. 확장 프로그램용 내보내기는 서식째 복사(text/html + text/plain)와 파일 받기로 제공한다(확장 프로그램 본체는 P7.2).

## P5.1·P5.2 랭킹 API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·규칙 | 오류 |
|---|---|---|---|---|
| `/api/rankings` | GET | 공개(로그인 시 내 순위) | `period`(week/month/all), `offset`(0~-52), `category`, `q`(닉네임·블로그 ID), `page`, `pageSize≤200`. 끝난 지난 기간은 처음 조회할 때 확정 스냅숏 생성 | 400 |
| `/api/rankings/champions` | GET | 공개 | 확정 기간 1위(명예의 전당) | — |
| `/api/rankings/me` | GET | 회원 | 내 확정 순위 이력·칭호 | 401 |
| `/api/admin/rankings/confirm` | POST | 관리자 | `{period:'week'|'month',offset:-1~-52}` 기간 확정(감사) | 403, 409 `PERIOD_NOT_FINISHED` |

규칙(새 규칙): 랭킹 공개(`profiles.ranking_public`, 기본 비공개)·활성 회원의 대표 블로그를 기간 안에서 가장 최근에 진단한 점수로 순위. 동점이면 먼저 기록한 회원, 그다음 닉네임 순. 주간은 KST 월요일 0시~, 월간은 1일 0시~. 확정 스냅숏(기준별 점수 포함)은 이후 결과로 바뀌지 않는다. 칭호: 확정 주간 1위 횟수, 확정 월간 1위. 공개 응답에 회원 id·이메일 없음. AI 인용·검색 노출 지표는 공급자 미설정으로 쓰지 않는다.

## P5.3–P5.5 이벤트·참여·리워드 API (2026-10-13)

| 경로 | 메서드 | 권한 | 입력·동작 | 오류 |
|---|---|---|---|---|
| `/api/events` | GET | 공개 | 게시·마감 이벤트(초안 제외), 진행 중 → 예정 → 종료 순, `phase` 포함 | — |
| `/api/events/:slug` | GET | 공개 | 상세 + 참여 수(철회 제외) | 404 |
| `/api/events/:slug/entry` | GET | 회원 | 이 이벤트의 내 참여(철회 제외) 또는 null | 401 |
| `/api/events/:slug/entries` | POST | 회원 | `{proofUrl?,note?}` 참여. 인증 글은 blog.naver.com·m.blog.naver.com·PostView 주소를 정규화하고 내 등록 블로그만 허용 | 400 `PROOF_NOT_OWN_BLOG`·`PROOF_REQUIRED`, 409 `ALREADY_ENTERED`·`EVENT_NOT_OPEN`·`ENTRIES_DISABLED`, 404 |
| `/api/event-entries/:id` | PATCH | 본인 | `{proofUrl?,note?,version}` 심사 전·기간 안에서만 | 404(남의 참여), 409 `ENTRY_REVIEWED`·`VERSION_CONFLICT`·`EVENT_NOT_OPEN` |
| `/api/event-entries/:id/withdraw` | POST | 본인 | `{version}` 심사 전 철회(이후 다시 참여 가능) | 404, 409 |
| `/api/me/events` | GET | 회원 | 내 참여 내역·리워드 | 401 |
| `/api/admin/events` | GET·POST | 관리자 | 목록(`q`,`status`, 상태별 참여 수) / 생성(slug·제목·요약·마크다운 본문·상태·KST 기간·인증 필수·승인 토큰·참여 신청 여부·내부 경로 CTA) | 403, 409 `SLUG_EXISTS`, 400 |
| `/api/admin/events/:id` | PATCH·DELETE | 관리자 | 버전 잠금 수정 / 참여 없는 이벤트만 삭제 | 409 `VERSION_CONFLICT`·`EVENT_HAS_ENTRIES`, 400 `INVALID_PERIOD` |
| `/api/admin/event-entries?slug=` | GET | 관리자 | 참여 목록(회원 이메일·닉네임, `status`·`q`) | 403, 404 |
| `/api/admin/event-entries/:id/review` | POST | 관리자 | `{decision:'approved'|'rejected',note?,version}`. 승인 시 이벤트 토큰 1회 지급, 승인→반려 시 회수 | 409 `VERSION_CONFLICT`·`ENTRY_WITHDRAWN`·`NEGATIVE_BALANCE` |
| `/api/admin/rewards` | GET·POST | 관리자 | 내역(`kind`,`status`,`q`) / 지급 `{userId|email, tokens|item, description, eventSlug?}` | 404 `USER_NOT_FOUND`·`EVENT_NOT_FOUND`, 400 |
| `/api/admin/rewards/:id/revoke` | POST | 관리자 | `{version}` 회수(토큰은 반대 분개) | 409 `REWARD_REVOKED`·`NEGATIVE_BALANCE`·`VERSION_CONFLICT` |
| `/api/admin/rewards/ranking` | POST | 관리자 | `{period,offset:-1~-52,top,tokens,eventSlug?}` 확정 기간 상위 N명 지급(같은 기간·회원 1회) | 409 `PERIOD_NOT_CONFIRMED` |

규칙: 기간은 시작 포함·종료 제외(관리자 입력은 KST). 당첨 내역(이벤트 상세)은 유효 리워드만, 닉네임은 첫 글자 외 가림. 모든 관리자 변경·참여 제출/수정/철회는 감사 기록. 쿠폰(할인)은 P6 결제 모델과 연결 예정이며 지금은 상품·쿠폰명을 기록하는 상품 리워드로 지급 내역만 관리한다(발송은 별도).

## P6 요금제·쿠폰·구독·결제·환불 API (2026-10-14)

| 경로 | 메서드 | 권한 | 입력·동작 | 오류 |
|---|---|---|---|---|
| `/api/billing/plans` | GET | 공개 | 판매 요금제(첫 호출 시 캡처 가격 카드로 시드), `paymentsConfigured` | — |
| `/api/billing/webhooks/toss` | POST | 결제사(Origin 없음) | `PAYMENT_STATUS_CHANGED` 등. 본문을 믿지 않고 paymentKey로 결제사 재조회 후 주문 번호·금액 대조, DONE→승인, CANCELED/PARTIAL_CANCELED→취소 반영, ABORTED/EXPIRED→실패. 같은 이벤트는 `duplicate` | 400 형식, 503 미설정(결제사가 재전송) |
| `/api/billing/me` | GET | 회원 | 구독·결제·환불·결제 설정 여부 | 401 |
| `/api/billing/trial` | POST | 회원 | `{planCode}` 체험(대표 블로그 필요, 일수 비례 토큰) | 400 `BLOG_REQUIRED`, 409 `TRIAL_ALREADY_USED`·`ALREADY_SUBSCRIBED`·`TRIAL_NOT_AVAILABLE` |
| `/api/billing/subscription/cancel`·`/resume` | POST | 회원 | `{version}` 기간 종료 해지 예약·취소 | 404 `NO_SUBSCRIPTION`, 409 |
| `/api/billing/coupons/redeem` | POST | 회원 | `{code}` 토큰 쿠폰(대소문자 무시) | 404, 409 `COUPON_ALREADY_USED`·`COUPON_EXHAUSTED`·`COUPON_NOT_ACTIVE`, 400 `COUPON_CHECKOUT_ONLY` |
| `/api/billing/checkout` | POST | 회원 | `{planCode,couponCode?}` 서버가 금액 계산·할인 쿠폰 예약·주문 30분 유효. 0원은 즉시 확정. 이전 대기 주문은 만료 | 503 `PAYMENT_PROVIDER_NOT_CONFIGURED`, 409 `ALREADY_SUBSCRIBED`(종료 3일 전부터 연장)·`RENEWAL_ALREADY_PAID`·`PLAN_CHANGE_UNSUPPORTED`, 400 `FREE_PLAN` |
| `/api/billing/confirm` | POST | 회원 | `{paymentKey,orderId,amount}` 주인·상태·금액 대조 후 `Idempotency-Key: confirm-{orderId}`로 승인. 같은 주문 재승인은 같은 결과 | 404, 400 `AMOUNT_MISMATCH`(결제사 호출 없음), 402 `PAYMENT_FAILED`, 409 `ORDER_ALREADY_PAID`·`PAYMENT_EXPIRED`, 502 `PROVIDER_MISMATCH` |
| `/api/billing/payments/:orderId` | GET | 본인 | 저장된 주문 상태 | 404 |
| `/api/billing/payments/:id/refund` | POST | 본인 | `{reason}` 승인 후 7일 안 남은 금액 전부 요청 | 409 `REFUND_WINDOW_CLOSED`·`REFUND_PENDING`·`NOTHING_TO_REFUND` |
| `/api/admin/plans` | GET·POST·PATCH·DELETE | 관리자 | 요금제 CRUD(버전 잠금, 구독·결제에 쓰인 요금제 삭제 금지) | 409 `CODE_EXISTS`·`PLAN_IN_USE` |
| `/api/admin/coupons` | GET·POST·PATCH | 관리자 | 쿠폰 생성·중지/재개·한도·종료 수정(코드·종류·값은 불변) | 409 `CODE_EXISTS` |
| `/api/admin/payments` | GET | 관리자 | 결제 목록(`status`,`q`) | 403 |
| `/api/admin/payments/:id/refund` | POST | 관리자 | `{amount?,reason}` 직접 환불(부분 가능) 후 즉시 처리 | 400 `AMOUNT_TOO_LARGE`, 409 |
| `/api/admin/refunds` · `/:id/decide` | GET·POST | 관리자 | `{decision,note,version}` 승인 시 `Idempotency-Key: refund-{id}`로 결제사 취소, 실패는 failed(같은 키로 재승인) | 502 `REFUND_FAILED`, 503 미설정, 409 |

결제사: 토스페이먼츠 코어 API(`NAEO_TOSS_CLIENT_KEY`, `NAEO_TOSS_SECRET_KEY`, 선택 `NAEO_TOSS_API_BASE`). 키가 없으면 결제 버튼은 '결제 미설정'. 화면: /pricing(DB 요금제·상태별 버튼·체험/쿠폰/결제창 v2 SDK), /payment/complete(성공 시 서버 승인, 실패 복귀 시 주문 실패 처리, 저장된 상태로 표시), 설정 '구독·결제', /admin/billing, /admin/payments. 작업자가 1분마다 기간 종료 처리(미사용 기간 토큰 소멸·예약 갱신·종료)와 버려진 주문 만료.

## P7.1 구글·네이버 로그인 API (2026-10-14)

| 경로 | 메서드 | 권한 | 입력·동작 | 오류(이동) |
|---|---|---|---|---|
| `/api/auth/oauth/:provider/start` | GET | 공개(`intent=link`는 회원) | `next`(safeNext 제한), state·PKCE(S256, 구글)·nonce 생성, `naeo_oauth` HttpOnly 쿠키(경로 /api/auth/oauth, 10분)로 브라우저에 묶고 공급자 인가 주소로 302 | 키 없음 → `/login?oauthError=OAUTH_NOT_CONFIGURED` |
| `/api/auth/oauth/:provider/callback` | GET | 공급자 이동 | state 일회 소비·쿠키 대조 → 코드 교환(구글 토큰+ID 토큰 iss·aud·exp·nonce, 네이버 토큰+`/v1/nid/me`) → 로그인/가입(새 회원은 `/auth/terms?next=`)·연결(`/dashboard/settings?oauthLinked=` ) | `/login?oauthError=` 또는 로그인 중이면 설정으로: `OAUTH_STATE_INVALID`·`OAUTH_DENIED`·`OAUTH_EMAIL_EXISTS`·`OAUTH_EMAIL_REQUIRED`·`OAUTH_ALREADY_LINKED`·`OAUTH_PROVIDER_LINKED`·`ACCOUNT_SUSPENDED`·`OAUTH_EXCHANGE_FAILED` |
| `/api/account/oauth` | GET | 회원 | 연결 목록·비밀번호 보유·서비스별 설정 여부 | 401 |
| `/api/account/oauth/:provider` | DELETE | 회원 | 연결 해제 | 404, 409 `LAST_LOGIN_METHOD` |
| `/api/account/password/initial` | POST | 회원 | `{newPassword}` OAuth 가입 회원의 첫 비밀번호(세션 생성 10분 안) | 403 `REAUTH_REQUIRED`, 409 `PASSWORD_ALREADY_SET` |

설정: `NAEO_GOOGLE_CLIENT_ID/SECRET`, `NAEO_NAVER_CLIENT_ID/SECRET`(리디렉션 URI `{NAEO_APP_URL}/api/auth/oauth/{google|naver}/callback`). `NAEO_OAUTH_ENDPOINT_BASE`는 로컬 검증 전용(localhost만). `/auth/google`·`/auth/naver`는 시작 주소로 이동.

## P7.2·P7.3 OAuth 인가 서버·MCP (2026-10-14)

| 경로 | 메서드 | 권한 | 입력·동작 | 오류 |
|---|---|---|---|---|
| `/.well-known/oauth-authorization-server` | GET | 공개 | RFC 8414 메타데이터(동의·토큰·등록·철회 주소, S256, 공개 클라이언트) | — |
| `/.well-known/oauth-protected-resource[/api/mcp]` | GET | 공개 | RFC 9728(`resource={origin}/api/mcp`, 인가 서버, 범위) | — |
| `/api/oauth/register` | POST | 공개(서버 간) | RFC 7591 `{client_name,redirect_uris}` https·루프백 http·앱 전용 스킴만, 최대 5개 | 400 `invalid_client_metadata`·`invalid_redirect_uri` |
| `/oauth/consent` | GET 화면 | 로그인(전체 요청을 next로 보존) | 앱·돌아갈 주소가 틀리면 캡처 오류 상자, `response_type`·PKCE·범위·`resource` 오류는 앱으로 `error=` | `invalid_request`·`invalid_scope`·`invalid_target`·`access_denied` |
| `/api/oauth/authorize` | POST | 회원+사이트 Origin | 동의 화면의 승인/거부 → `{redirect}`(코드 5분·일회) | 403 |
| `/api/oauth/token` | POST form | 공개(서버 간) | `authorization_code`(PKCE·redirect·resource 대조, 성공 시 코드 소비), `refresh_token`(회전, 재사용 시 계열 철회). 응답 `{access_token,token_type,expires_in:3600,refresh_token,scope}` | 400 `invalid_grant`·`invalid_target`·`unsupported_grant_type` (RFC 6749 형식) |
| `/api/oauth/revoke` | POST form | 공개(서버 간) | RFC 7009 `token` 철회(리프레시면 계열) | 항상 200 |
| `/api/account/apps` · `/:clientId` | GET·DELETE | 회원 | 연결된 앱(권한·연결일·마지막 사용·호출 수) / 앱의 모든 토큰 철회 | 404 |
| `/auth/extension` | GET 화면 | 공개 | `extension_id`가 `NAEO_EXTENSION_IDS`에 있으면 확장 클라이언트(`https://{id}.chromiumapp.org/`)로 동의 화면 이동 | 캡처 오류 상자 |
| `/api/mcp` | POST | Bearer(대상=/api/mcp) | MCP Streamable HTTP(2025-06-18·2025-03-26): `initialize`·`ping`·`tools/list`·`tools/call`, 알림 202. 도구: `naeo_blog_status`·`naeo_token_balance`·`naeo_list_drafts`·`naeo_get_draft`(read), `naeo_create_draft`(write), `naeo_request_generation`(generate, 토큰 차감·미설정이면 차감 없이 isError). 호출은 `mcp_calls` 기록, 연결별 분당 120회 | 401+`WWW-Authenticate: Bearer resource_metadata=…`, 403 다른 사이트 Origin, 405 GET, JSON-RPC -32601/-32602/-32700, 권한 부족은 isError |
