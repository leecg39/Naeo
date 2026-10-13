# 전체 페이지 CRUD 계획

원본 page.md의 구체 URL 79개와 동적 경로 4개를 모두 포함한다. 각 행은 DB·API·화면·권한·실행 증거를 함께 요구한다. 기존 화면 캡처는 백엔드 증거가 아니다. 모델과 관리자 UX는 REA에서 확인되지 않은 부분에 대한 신규 설계다.

| 페이지 | 단계 | 데이터 모델 | CRUD·화면 | 수용 조건 |
|---|---|---|---|---|
| `/` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/admin` | P2/P8 | content_pages, content_revisions, announcements, audit_logs, scan_jobs | 운영 현황 및 콘텐츠·공지·FAQ·법적 문서 CRUD와 감사 로그 | 일반 계정 403, 모든 관리 경로 직접 접근, 수정 공개 반영 |
| `/admin/blog` | P2 | articles, article_categories, content_revisions | 기사·카테고리 CRUD, 발행·비공개, 공개 URL 미리보기 | 일반 계정 403, 모든 관리 경로 직접 접근, 수정 공개 반영 |
| `/admin/event` | P5 | events, event_entries, reward_claims | 이벤트 편집기, 참가 조건·기간·보상 설정 CRUD | 일반 계정 403, 모든 관리 경로 직접 접근, 수정 공개 반영 |
| `/admin/events` | P5 | events, event_entries, reward_claims | 이벤트 목록·참가 심사·반려·보상 지급 | 일반 계정 403, 모든 관리 경로 직접 접근, 수정 공개 반영 |
| `/admin/inquiries` | P2 | inquiries, inquiry_messages | 문의 검색·상세·상태·답변·삭제 | 일반 계정 403, 모든 관리 경로 직접 접근, 수정 공개 반영 |
| `/admin/inquiries/templates` | P2 | inquiry_templates | 답변 템플릿 CRUD와 문의에 적용 | 일반 계정 403, 모든 관리 경로 직접 접근, 수정 공개 반영 |
| `/admin/keywords` | P3 | keywords, keyword_metrics, recommendations | 키워드·주제·검색 지표 CRUD, 출처·측정일 표시 | 일반 계정 403, 모든 관리 경로 직접 접근, 수정 공개 반영 |
| `/admin/rewards` | P5/P6 | reward_claims, coupons, coupon_redemptions, credit_ledger | 쿠폰·보상 정책 CRUD·지급/철회, 원장 반대 분개 | 일반 계정 403, 모든 관리 경로 직접 접근, 수정 공개 반영 |
| `/admin/scan-health` | P3 | scan_jobs, scan_results | 작업 상태·실패 원인·재시도·취소·실행 로그 | 일반 계정 403, 모든 관리 경로 직접 접근, 수정 공개 반영 |
| `/admin/users` | P1 | users, profiles, sessions, audit_logs | 계정 검색·조회·역할/상태 변경·삭제, 마지막 관리자 보호 | 일반 계정 403, 모든 관리 경로 직접 접근, 수정 공개 반영 |
| `/admin/writing` | P4 | drafts, draft_revisions, generation_jobs, media_assets | 생성 작업·작성 템플릿·비용 정책 CRUD, 실패 재시도 | 일반 계정 403, 모든 관리 경로 직접 접근, 수정 공개 반영 |
| `/auth/extension` | P1/P7 | users, sessions, oauth_accounts, oauth_grants, extension_tokens | 가입·로그인·정보 변경·탈퇴, 동의·발급/철회 | 유지/만료/로그아웃, 비로그인 차단, OAuth state/PKCE |
| `/auth/google` | P1/P7 | users, sessions, oauth_accounts, oauth_grants, extension_tokens | 가입·로그인·정보 변경·탈퇴, 동의·발급/철회 | 유지/만료/로그아웃, 비로그인 차단, OAuth state/PKCE |
| `/blog` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/event/naeo-review-event` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/guide/ai-picks-guide` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/guide/channel-analysis-guide` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/guide/competitor-analysis-guide` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/guide/dashboard-guide` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/guide/golden-keywords-guide` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/guide/keyword-recommendation-guide` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/guide/today-action-guide` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/marketing/ai-briefing-cited-posts` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/marketing/ai-briefing-food-playbook` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/marketing/ai-briefing-image-citation` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/marketing/ai-briefing-tips-1-travel-life` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/marketing/ai-briefing-tips-2-life-culture` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/marketing/ai-briefing-tips-3-knowledge-hobby` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/marketing/golden-keywords` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/marketing/mate-free-diagnosis` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/marketing/what-is-ai-briefing` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/news/across-modu-startup-ditoday` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/news/across-modu-startup-mt` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/blog/news/naver-mate-naeo-byline` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/contact` | P2 | inquiries, inquiry_messages, inquiry_templates | 문의 생성·본인 조회/수정/삭제, 관리자 답변·상태·템플릿 CRUD | 빈값/과다 요청, 계정 격리, 답변 후 수정 정책 |
| `/dashboard` | P3 | blogs, blog_posts, scan_jobs, scan_results, citations, action_items | 블로그 CRUD, 수집/분석 작업·취소/재시도, 결과 조회, 할 일 수정 | 실제 수집 출처, 재시작/실패 복구, SSRF 차단, 계정 격리 |
| `/dashboard/ai-picks` | P3 | blogs, blog_posts, scan_jobs, scan_results, citations, action_items | 블로그 CRUD, 수집/분석 작업·취소/재시도, 결과 조회, 할 일 수정 | 실제 수집 출처, 재시작/실패 복구, SSRF 차단, 계정 격리 |
| `/dashboard/competitors` | P3 | competitors, blogs, scan_results | 추가·목록·메모 수정·삭제·비교 | 중복 주소·한도·두 계정 격리·실제 결과 비교 |
| `/dashboard/events` | P5 | events, event_entries, reward_claims | 관리 이벤트 CRUD, 사용자 참가 CRUD, 심사·지급/취소 | 기간/중복/소유권/심사 상태, 중복 보상 방지 |
| `/dashboard/mate` | P3 | blogs, blog_posts, scan_jobs, scan_results, citations, action_items | 블로그 CRUD, 수집/분석 작업·취소/재시도, 결과 조회, 할 일 수정 | 실제 수집 출처, 재시작/실패 복구, SSRF 차단, 계정 격리 |
| `/dashboard/recommendations` | P3 | keywords, keyword_metrics, recommendations, saved_keywords | 추천 조회/필터, 저장/완료/해제 CRUD, 관리 키워드 CRUD | 검색·필터·페이지 이동, 재로그인 보존, 권한·중복 |
| `/dashboard/settings` | P1/P6/P7 | profiles, blogs, contact_details, notification_preferences, subscriptions, coupon_redemptions | 프로필/블로그/연락처/공개 설정 CRUD, 구독·쿠폰·탈퇴 | 새 세션 보존, version, 권한·잔액 변경 차단, 실제 연락처 인증 |
| `/dashboard/write` | P4 | drafts, draft_revisions, generation_jobs, media_assets, share_links | 초안 CRUD·버전·생성·미디어 업로드/삭제·공유/철회·내보내기 | 저장/재로그인/충돌/삭제, 생성 실패/취소, 파일 권한·실제 다운로드 |
| `/dev/event-preview` | P2/P7 | content_revisions, creative_projects | 미리보기·임시 저장·공개 샘플 | 미리보기는 공개 데이터를 변경하지 않음, 비공개 미노출 |
| `/dev/nav-preview` | P2/P7 | content_revisions, creative_projects | 미리보기·임시 저장·공개 샘플 | 미리보기는 공개 데이터를 변경하지 않음, 비공개 미노출 |
| `/event` | P5 | events, event_entries, reward_claims | 관리 이벤트 CRUD, 사용자 참가 CRUD, 심사·지급/취소 | 기간/중복/소유권/심사 상태, 중복 보상 방지 |
| `/event/naeo-review` | P5 | events, event_entries, reward_claims | 관리 이벤트 CRUD, 사용자 참가 CRUD, 심사·지급/취소 | 기간/중복/소유권/심사 상태, 중복 보상 방지 |
| `/event/ranking-reward` | P5 | events, event_entries, reward_claims | 관리 이벤트 CRUD, 사용자 참가 CRUD, 심사·지급/취소 | 기간/중복/소유권/심사 상태, 중복 보상 방지 |
| `/faq` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/features` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/guide/extension-publish` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/guide/writing` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/images` | P4 | drafts, draft_revisions, generation_jobs, media_assets, share_links | 초안 CRUD·버전·생성·미디어 업로드/삭제·공유/철회·내보내기 | 저장/재로그인/충돌/삭제, 생성 실패/취소, 파일 권한·실제 다운로드 |
| `/login` | P1/P7 | users, sessions, oauth_accounts, oauth_grants, extension_tokens | 가입·로그인·정보 변경·탈퇴, 동의·발급/철회 | 유지/만료/로그아웃, 비로그인 차단, OAuth state/PKCE |
| `/mate` | P3 | blogs, blog_posts, scan_jobs, scan_results, citations, action_items | 블로그 CRUD, 수집/분석 작업·취소/재시도, 결과 조회, 할 일 수정 | 실제 수집 출처, 재시작/실패 복구, SSRF 차단, 계정 격리 |
| `/mate/s` | P3 | blogs, blog_posts, scan_jobs, scan_results, citations, action_items | 블로그 CRUD, 수집/분석 작업·취소/재시도, 결과 조회, 할 일 수정 | 실제 수집 출처, 재시작/실패 복구, SSRF 차단, 계정 격리 |
| `/mcp` | P7 | oauth_clients, oauth_grants, api_tokens, mcp_calls | 클라이언트 등록·연결·토큰 조회/철회·MCP 도구 실행 | 실제 클라이언트 연결, scope, 일회 코드·PKCE, 감사 기록 |
| `/oauth/consent` | P1/P7 | users, sessions, oauth_accounts, oauth_grants, extension_tokens | 가입·로그인·정보 변경·탈퇴, 동의·발급/철회 | 유지/만료/로그아웃, 비로그인 차단, OAuth state/PKCE |
| `/payment/complete` | P6 | plans, subscriptions, payments, refunds, credit_ledger, coupons | 상품 관리·체험/구독/해지·쿠폰 CRUD·사용·환불 | 금액/서명 검증, 중복 결제·차감 차단, 실제 샌드박스 왕복 |
| `/preview` | P2/P7 | content_revisions, creative_projects | 미리보기·임시 저장·공개 샘플 | 미리보기는 공개 데이터를 변경하지 않음, 비공개 미노출 |
| `/pricing` | P6 | plans, subscriptions, payments, refunds, credit_ledger, coupons | 상품 관리·체험/구독/해지·쿠폰 CRUD·사용·환불 | 금액/서명 검증, 중복 결제·차감 차단, 실제 샌드박스 왕복 |
| `/privacy` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/privacy/extension` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/ranking` | P5 | ranking_periods, ranking_entries, champions | 공개 기간·주제·내 순위·히스토리, 관리자 스냅샷 CRUD | 동점·기간·공개 설정, 실제 측정 근거, 관리 반영 |
| `/refund` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/social/aeo-carousel` | P7 | creative_projects, creative_slides, export_jobs | 프로젝트/슬라이드 CRUD·정렬·복제·내보내기 | 재접속 보존, 출력 파일 실제 열기, 소유권·공유·실패 |
| `/social/aeo-carousel/export` | P7 | creative_projects, creative_slides, export_jobs | 프로젝트/슬라이드 CRUD·정렬·복제·내보내기 | 재접속 보존, 출력 파일 실제 열기, 소유권·공유·실패 |
| `/social/banner-preview` | P7 | creative_projects, creative_slides, export_jobs | 프로젝트/슬라이드 CRUD·정렬·복제·내보내기 | 재접속 보존, 출력 파일 실제 열기, 소유권·공유·실패 |
| `/social/banner-preview/frame` | P7 | creative_projects, creative_slides, export_jobs | 프로젝트/슬라이드 CRUD·정렬·복제·내보내기 | 재접속 보존, 출력 파일 실제 열기, 소유권·공유·실패 |
| `/social/mate-ad` | P7 | creative_projects, creative_slides, export_jobs | 프로젝트/슬라이드 CRUD·정렬·복제·내보내기 | 재접속 보존, 출력 파일 실제 열기, 소유권·공유·실패 |
| `/social/mate-ad/export` | P7 | creative_projects, creative_slides, export_jobs | 프로젝트/슬라이드 CRUD·정렬·복제·내보내기 | 재접속 보존, 출력 파일 실제 열기, 소유권·공유·실패 |
| `/terms` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/updates` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/updates/2026-06-10-ranking-archive-hall-of-fame` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/updates/2026-06-11-mate-free-diagnosis` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/updates/2026-06-24-golden-keywords` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/updates/2026-09-16-post-level-exposure` | P2 | content_pages, content_revisions, announcements | 관리자 콘텐츠 CRUD·발행/비공개·미리보기, 공개 화면 읽기 | 관리 변경의 공개 반영, 초안 비공개, 삭제 404, 충돌 409 |
| `/youtube/aeo-intro` | P7 | creative_projects, creative_slides, export_jobs | 프로젝트/슬라이드 CRUD·정렬·복제·내보내기 | 재접속 보존, 출력 파일 실제 열기, 소유권·공유·실패 |
| `/blog/:category/:slug` | P2 | articles, article_categories, content_revisions | 기사/카테고리 CRUD·검색·발행/비공개·미리보기 | 20개 seed, 새 URL, 수정/삭제 반영, 필터·페이지 이동 |
| `/dashboard/events/:slug` | P5 | events, event_entries, reward_claims | 관리 이벤트 CRUD, 사용자 참가 CRUD, 심사·지급/취소 | 기간/중복/소유권/심사 상태, 중복 보상 방지 |
| `/event/:slug` | P5 | events, event_entries, reward_claims | 관리 이벤트 CRUD, 사용자 참가 CRUD, 심사·지급/취소 | 기간/중복/소유권/심사 상태, 중복 보상 방지 |
| `/p/:id/images` | P4 | drafts, draft_revisions, generation_jobs, media_assets, share_links | 초안 CRUD·버전·생성·미디어 업로드/삭제·공유/철회·내보내기 | 저장/재로그인/충돌/삭제, 생성 실패/취소, 파일 권한·실제 다운로드 |

공개 문서 수정은 관리자 편집기에서 수행한다. 금전 원장은 기록 자체를 임의 수정/삭제하지 않고 보정 거래로 취소한다. 개인정보 삭제와 회계 기록 보존을 분리한다. legacy 업데이트 경로는 308 리다이렉트와 글 위치를 함께 검증한다.
