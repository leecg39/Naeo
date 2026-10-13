# NAEO 전체 페이지·경로 목록

> 대상: https://www.naeo.kr/  
> 확인일: 2026-10-13  
> 수집 기준: 공식 사이트맵, 공개 HTML 내부 링크, 공개 JS의 배포 라우트 목록, llms.txt, 블로그 RSS.

**배포 라우트는 정적 54개와 동적 패턴 4종이며, 실제 값이 들어간 URL은 중복 제거 후 79개를 발견했다.** 그중 공개 HTTP 200 페이지는 39개, 리디렉션 주소는 4개, 배포 코드로 존재만 확인하고 접속하지 않은 경로는 36개다.

| 집계 | 개수 | 의미 |
|---|---:|---|
| 정적 라우트 | 54 | 현재 공개 JS의 `_sentryRouteManifest.staticRoutes` |
| 동적 라우트 패턴 | 4 | `:slug`, `:id` 등 값이 필요한 경로 정의 |
| 추가로 발견한 구체 URL | 25 | 블로그 글 20 + 이벤트 상세 1 + 업데이트 리디렉션 4 |
| 구체 URL 전체 | **79** | 정적 54 + 추가 25. 동적 패턴 4종은 여기에 더하지 않음 |
| HTTP 200 확인 | 39 | 공개 기본·가이드·정책 18 + 블로그 글 20 + 이벤트 상세 1 |
| HTTP 308 확인 | 4 | 업데이트 상세의 이전 주소 |
| 등록 확인·접속 미검증 | 36 | 대시보드·관리자·인증·결제·미리보기 등 |

아래 “등록·미접속”은 404나 접근 불가라는 뜻이 아니다. 코드에 경로가 등록되어 있다는 의미이며 화면·접근 권한은 확인하지 않았다. 접속하지 않은 화면의 한국어 이름은 경로·기존 공개 코드에 따른 설명용 이름이다. 쿼리스트링과 `#앵커`는 별도 페이지로 중복 집계하지 않았다.

## 1. 정적 페이지 54개

근거 기호: **R** 배포 라우트 목록 · **S** 사이트맵 · **L** 공개 HTML 링크/기존 공개 화면 · **T** llms.txt · **F** 블로그 RSS.

### 1-1. 공개 서비스·가이드·정책 — 18개

| 번호 | 페이지 | URL | 확인 상태 | 근거 |
|---|---|---|---|---|
| P01 | 홈 — 네이버 블로그 AI 브리핑 인용 진단 | [/](https://www.naeo.kr/) | HTTP 200 | R · S · L · T |
| P02 | 매거진 | [/blog](https://www.naeo.kr/blog) | HTTP 200 | R · S · L · T |
| P03 | 문의하기 | [/contact](https://www.naeo.kr/contact) | HTTP 200 | R · S · L · T |
| P04 | NAEO 이벤트 | [/event](https://www.naeo.kr/event) | HTTP 200 | R · L |
| P05 | NAEO 랭킹 리워드 \| 매주 월요일, 커피 받는 랭킹 | [/event/ranking-reward](https://www.naeo.kr/event/ranking-reward) | HTTP 200 | R · L |
| P06 | 자주 묻는 질문 | [/faq](https://www.naeo.kr/faq) | HTTP 200 | R · S · L |
| P07 | NAEO 기능 소개 \| 네이버 AI 브리핑 모니터링 & AEO 진단 | [/features](https://www.naeo.kr/features) | HTTP 200 | R · S · T |
| P08 | AI로 쓴 글, 네이버 블로그에 발행하기 | [/guide/extension-publish](https://www.naeo.kr/guide/extension-publish) | HTTP 200 | R · L |
| P09 | AI 글쓰기 사용법 | [/guide/writing](https://www.naeo.kr/guide/writing) | HTTP 200 | R |
| P10 | 내 블로그, 네이버 메이트 될 수 있을까? 30초 무료 진단 | [/mate](https://www.naeo.kr/mate) | HTTP 200 | R · L |
| P11 | ChatGPT·Claude에 NAEO 연결하기 \| AI로 네이버 블로그 글쓰기 | [/mcp](https://www.naeo.kr/mcp) | HTTP 200 | R · L |
| P12 | NAEO 요금제 \| 네이버 AI 검색 최적화 진단 | [/pricing](https://www.naeo.kr/pricing) | HTTP 200 | R · S · L · T |
| P13 | 개인정보처리방침 | [/privacy](https://www.naeo.kr/privacy) | HTTP 200 | R · S · L |
| P14 | 개인정보 처리방침 (NAEO Chrome Extension) | [/privacy/extension](https://www.naeo.kr/privacy/extension) | HTTP 200 | R · S |
| P15 | AI 추천 순위 리더보드 | [/ranking](https://www.naeo.kr/ranking) | HTTP 200 | R · S · L · T |
| P16 | 환불 규정 | [/refund](https://www.naeo.kr/refund) | HTTP 200 | R · S · L |
| P17 | 이용약관 | [/terms](https://www.naeo.kr/terms) | HTTP 200 | R · S · L |
| P18 | 업데이트 | [/updates](https://www.naeo.kr/updates) | HTTP 200 | R · S · L · T |

### 1-2. 회원 대시보드 — 8개

| 번호 | 페이지 | URL | 확인 상태 | 근거 |
|---|---|---|---|---|
| P19 | 대시보드 | [/dashboard](https://www.naeo.kr/dashboard) | 등록·미접속 | R |
| P20 | AI 인용 현황 | [/dashboard/ai-picks](https://www.naeo.kr/dashboard/ai-picks) | 등록·미접속 | R |
| P21 | 경쟁 콘텐츠 | [/dashboard/competitors](https://www.naeo.kr/dashboard/competitors) | 등록·미접속 | R |
| P22 | 회원 이벤트 | [/dashboard/events](https://www.naeo.kr/dashboard/events) | 등록·미접속 | R |
| P23 | 네이버 메이트 진단 | [/dashboard/mate](https://www.naeo.kr/dashboard/mate) | 등록·미접속 | R · L |
| P24 | 키워드 추천 | [/dashboard/recommendations](https://www.naeo.kr/dashboard/recommendations) | 등록·미접속 | R |
| P25 | 계정·블로그 설정 | [/dashboard/settings](https://www.naeo.kr/dashboard/settings) | 등록·미접속 | R |
| P26 | AI 글쓰기 | [/dashboard/write](https://www.naeo.kr/dashboard/write) | 등록·미접속 | R · L |

### 1-3. 관리자 — 11개

| 번호 | 페이지 | URL | 확인 상태 | 근거 |
|---|---|---|---|---|
| P27 | 관리자 메인 | [/admin](https://www.naeo.kr/admin) | 등록·미접속 | R |
| P28 | 블로그 관리 | [/admin/blog](https://www.naeo.kr/admin/blog) | 등록·미접속 | R |
| P29 | 이벤트 관리 (단수 경로) | [/admin/event](https://www.naeo.kr/admin/event) | 등록·미접속 | R |
| P30 | 이벤트 관리 (복수 경로) | [/admin/events](https://www.naeo.kr/admin/events) | 등록·미접속 | R |
| P31 | 문의 관리 | [/admin/inquiries](https://www.naeo.kr/admin/inquiries) | 등록·미접속 | R |
| P32 | 문의 답변 템플릿 | [/admin/inquiries/templates](https://www.naeo.kr/admin/inquiries/templates) | 등록·미접속 | R |
| P33 | 키워드 관리 | [/admin/keywords](https://www.naeo.kr/admin/keywords) | 등록·미접속 | R |
| P34 | 리워드 관리 | [/admin/rewards](https://www.naeo.kr/admin/rewards) | 등록·미접속 | R |
| P35 | 스캔 상태 관리 | [/admin/scan-health](https://www.naeo.kr/admin/scan-health) | 등록·미접속 | R |
| P36 | 사용자 관리 | [/admin/users](https://www.naeo.kr/admin/users) | 등록·미접속 | R |
| P37 | 글쓰기 관리 | [/admin/writing](https://www.naeo.kr/admin/writing) | 등록·미접속 | R |

### 1-4. 로그인·인증·결제 — 5개

| 번호 | 페이지 | URL | 확인 상태 | 근거 |
|---|---|---|---|---|
| P38 | 확장 프로그램 인증 | [/auth/extension](https://www.naeo.kr/auth/extension) | 등록·미접속 | R |
| P39 | Google 인증 | [/auth/google](https://www.naeo.kr/auth/google) | 등록·미접속 | R |
| P40 | 로그인 | [/login](https://www.naeo.kr/login) | 등록·미접속 | R · L |
| P41 | OAuth 권한 동의 | [/oauth/consent](https://www.naeo.kr/oauth/consent) | 등록·미접속 | R |
| P42 | 결제 완료 | [/payment/complete](https://www.naeo.kr/payment/complete) | 등록·미접속 | R |

### 1-5. 개발·제작·미리보기·공유 — 12개

| 번호 | 페이지 | URL | 확인 상태 | 근거 |
|---|---|---|---|---|
| P43 | 이벤트 개발 미리보기 | [/dev/event-preview](https://www.naeo.kr/dev/event-preview) | 등록·미접속 | R |
| P44 | 내비게이션 개발 미리보기 | [/dev/nav-preview](https://www.naeo.kr/dev/nav-preview) | 등록·미접속 | R |
| P45 | 이미지 관련 화면 | [/images](https://www.naeo.kr/images) | 등록·미접속 | R |
| P46 | 메이트 공유 관련 화면 | [/mate/s](https://www.naeo.kr/mate/s) | 등록·미접속 | R |
| P47 | 미리보기 | [/preview](https://www.naeo.kr/preview) | 등록·미접속 | R |
| P48 | AEO 캐러셀 | [/social/aeo-carousel](https://www.naeo.kr/social/aeo-carousel) | 등록·미접속 | R |
| P49 | AEO 캐러셀 내보내기 | [/social/aeo-carousel/export](https://www.naeo.kr/social/aeo-carousel/export) | 등록·미접속 | R |
| P50 | 배너 미리보기 | [/social/banner-preview](https://www.naeo.kr/social/banner-preview) | 등록·미접속 | R |
| P51 | 배너 프레임 | [/social/banner-preview/frame](https://www.naeo.kr/social/banner-preview/frame) | 등록·미접속 | R |
| P52 | 메이트 광고 | [/social/mate-ad](https://www.naeo.kr/social/mate-ad) | 등록·미접속 | R |
| P53 | 메이트 광고 내보내기 | [/social/mate-ad/export](https://www.naeo.kr/social/mate-ad/export) | 등록·미접속 | R |
| P54 | YouTube AEO 소개 | [/youtube/aeo-intro](https://www.naeo.kr/youtube/aeo-intro) | 등록·미접속 | R |

## 2. 동적 페이지 패턴 4종

아래는 경로 템플릿이다. `:category`, `:slug`, `:id`를 실제 값으로 대체해야 한다. 모든 사용자·비공개 ID를 열거한 목록은 아니다.

| 번호 | 패턴 | 용도 | 발견한 실제 URL |
|---|---|---|---|
| D01 | `/blog/:category/:slug` | 매거진 글 상세 | 아래 20개 |
| D02 | `/dashboard/events/:slug` | 회원 이벤트 상세 | 개별 slug 미확인 |
| D03 | `/event/:slug` | 공개 이벤트 상세 | `/event/naeo-review`, `/event/ranking-reward` |
| D04 | `/p/:id/images` | ID에 연결된 이미지 화면 | 개별 id 미확인 |

`/event/ranking-reward`는 동적 패턴에도 맞지만 별도의 정적 경로로 등록되어 있다. P 목록에서 이미 셌으므로 중복 추가하지 않았다.

## 3. 블로그·매거진 글 20개

모두 사이트맵·블로그 RSS에서 확인했고 HTTP 200을 받았다. 제목은 실제 문서 `<title>`을 기준으로 했다.

| 번호 | 분류 | 제목 | URL | 상태 |
|---|---|---|---|---|
| B01 | 이벤트 | NAEO 사용 후기 이벤트, 한 줄 평 쓰고 커피 받고 후기 쓰면 아이패드·에어팟까지 | [/blog/event/naeo-review-event](https://www.naeo.kr/blog/event/naeo-review-event) | HTTP 200 |
| B02 | 사용 가이드 | AI 인용 현황 사용법, 카테고리별 인용률 정확히 읽기 | [/blog/guide/ai-picks-guide](https://www.naeo.kr/blog/guide/ai-picks-guide) | HTTP 200 |
| B03 | 사용 가이드 | 채널 분석 사용법, 키워드별 채널 전략 세우기 | [/blog/guide/channel-analysis-guide](https://www.naeo.kr/blog/guide/channel-analysis-guide) | HTTP 200 |
| B04 | 사용 가이드 | 경쟁 콘텐츠 사용법, 누가 1등이고, AI는 누구를 추천하는지 | [/blog/guide/competitor-analysis-guide](https://www.naeo.kr/blog/guide/competitor-analysis-guide) | HTTP 200 |
| B05 | 사용 가이드 | NAEO 대시보드 사용법, 처음부터 끝까지 | [/blog/guide/dashboard-guide](https://www.naeo.kr/blog/guide/dashboard-guide) | HTTP 200 |
| B06 | 사용 가이드 | 황금 키워드 사용법, 통계 카드부터 포화도까지 읽는 법 | [/blog/guide/golden-keywords-guide](https://www.naeo.kr/blog/guide/golden-keywords-guide) | HTTP 200 |
| B07 | 사용 가이드 | 키워드 추천 사용법, 다음에 쓸 글을 1분 만에 정하기 | [/blog/guide/keyword-recommendation-guide](https://www.naeo.kr/blog/guide/keyword-recommendation-guide) | HTTP 200 |
| B08 | 사용 가이드 | 새 대시보드 활용법, 한 화면에서 다음 행동까지 | [/blog/guide/today-action-guide](https://www.naeo.kr/blog/guide/today-action-guide) | HTTP 200 |
| B09 | 마케팅 | AI 브리핑에 인용되는 글의 공통점, 인용 글 786개를 직접 읽고 찾은 것 | [/blog/marketing/ai-briefing-cited-posts](https://www.naeo.kr/blog/marketing/ai-briefing-cited-posts) | HTTP 200 |
| B10 | 마케팅 | 맛집 블로그가 AI 브리핑에 인용되려면, 실측 벤치마크와 글감 5개 | [/blog/marketing/ai-briefing-food-playbook](https://www.naeo.kr/blog/marketing/ai-briefing-food-playbook) | HTTP 200 |
| B11 | 마케팅 | 검색 순위 낮아도 AI 브리핑에 뜨는 법, 이미지 인용의 3가지 원형 | [/blog/marketing/ai-briefing-image-citation](https://www.naeo.kr/blog/marketing/ai-briefing-image-citation) | HTTP 200 |
| B12 | 마케팅 | 여행·먹거리·생활 블로그가 AI 브리핑에 인용되려면, 분야별 글쓰기 팁 8가지 | [/blog/marketing/ai-briefing-tips-1-travel-life](https://www.naeo.kr/blog/marketing/ai-briefing-tips-1-travel-life) | HTTP 200 |
| B13 | 마케팅 | 라이프·문화 블로그가 AI 브리핑에 인용되려면, 분야별 글쓰기 팁 8가지 | [/blog/marketing/ai-briefing-tips-2-life-culture](https://www.naeo.kr/blog/marketing/ai-briefing-tips-2-life-culture) | HTTP 200 |
| B14 | 마케팅 | 지식·취미 블로그가 AI 브리핑에 인용되려면, 분야별 글쓰기 팁 9가지 | [/blog/marketing/ai-briefing-tips-3-knowledge-hobby](https://www.naeo.kr/blog/marketing/ai-briefing-tips-3-knowledge-hobby) | HTTP 200 |
| B15 | 마케팅 | 내 주제에서 아직 비어 있는 '황금 키워드'를 찾아드려요 | [/blog/marketing/golden-keywords](https://www.naeo.kr/blog/marketing/golden-keywords) | HTTP 200 |
| B16 | 마케팅 | 네이버 메이트, 내 블로그도 될까? 30초 무료 진단으로 확인하세요 | [/blog/marketing/mate-free-diagnosis](https://www.naeo.kr/blog/marketing/mate-free-diagnosis) | HTTP 200 |
| B17 | 마케팅 | AI 브리핑이란? 블로거가 알아야 할 모든 것 | [/blog/marketing/what-is-ai-briefing](https://www.naeo.kr/blog/marketing/what-is-ai-briefing) | HTTP 200 |
| B18 | 언론 보도 | [디지털 인사이트] 어크로스, '모두의 창업' AI 솔루션 공급기업 선정 | [/blog/news/across-modu-startup-ditoday](https://www.naeo.kr/blog/news/across-modu-startup-ditoday) | HTTP 200 |
| B19 | 언론 보도 | [머니투데이] 어크로스, '모두의 창업' AI 솔루션 공급기업 선정 | [/blog/news/across-modu-startup-mt](https://www.naeo.kr/blog/news/across-modu-startup-mt) | HTTP 200 |
| B20 | 언론 보도 | [바이라인네트워크] 네이버 메이트 겨냥한 어크로스 'NAEO'…AI 브리핑 인용 여부 확인 | [/blog/news/naver-mate-naeo-byline](https://www.naeo.kr/blog/news/naver-mate-naeo-byline) | HTTP 200 |

## 4. 추가 이벤트 상세 1개

| 번호 | 제목 | URL | 상태 |
|---|---|---|---|
| E01 | NAEO 사용 후기 이벤트 — 당첨자 발표 | [/event/naeo-review](https://www.naeo.kr/event/naeo-review) | HTTP 200 |

## 5. 업데이트 리디렉션 4개

기존 내부 링크에 남아 있지만 현재는 독립 상세 페이지 대신 `/updates?focus=…`로 HTTP 308 이동한다. URL 목록에는 남기되 독립 콘텐츠 페이지와 구분한다.

| 번호 | 이전 URL | 현재 이동 목적지 | 상태 |
|---|---|---|---|
| U01 | [/updates/2026-06-10-ranking-archive-hall-of-fame](https://www.naeo.kr/updates/2026-06-10-ranking-archive-hall-of-fame) | [/updates?focus=2026-06-10-ranking-archive-hall-of-fame](https://www.naeo.kr/updates?focus=2026-06-10-ranking-archive-hall-of-fame) | HTTP 308 |
| U02 | [/updates/2026-06-11-mate-free-diagnosis](https://www.naeo.kr/updates/2026-06-11-mate-free-diagnosis) | [/updates?focus=2026-06-11-mate-free-diagnosis](https://www.naeo.kr/updates?focus=2026-06-11-mate-free-diagnosis) | HTTP 308 |
| U03 | [/updates/2026-06-24-golden-keywords](https://www.naeo.kr/updates/2026-06-24-golden-keywords) | [/updates?focus=2026-06-24-golden-keywords](https://www.naeo.kr/updates?focus=2026-06-24-golden-keywords) | HTTP 308 |
| U04 | [/updates/2026-09-16-post-level-exposure](https://www.naeo.kr/updates/2026-09-16-post-level-exposure) | [/updates?focus=2026-09-16-post-level-exposure](https://www.naeo.kr/updates?focus=2026-09-16-post-level-exposure) | HTTP 308 |

## 6. robots.txt에만 있는 추가 선언

다음 5개는 robots.txt의 수집 제외 선언에서 발견했지만 현재 배포 페이지 목록·사이트맵·수집한 링크로 페이지 존재를 확인하지 못했다. **페이지 총수 79개에는 포함하지 않았다.** `/ai-check/`, `/report/`는 단일 페이지가 아닌 경로 접두어일 수도 있다.

| 선언 경로 | 확인 근거 | 페이지 존재 |
|---|---|---|
| `/ai-check/` | robots.txt Disallow | 미확인 |
| `/report/` | robots.txt Disallow | 미확인 |
| `/analyze` | robots.txt Disallow | 미확인 |
| `/result` | robots.txt Disallow | 미확인 |
| `/rss-extract` | robots.txt Disallow | 미확인 |

또한 `/dashboard/`, `/auth/`, `/api/` 제외 선언이 있다. `/api/*`는 페이지가 아닌 서비스 인터페이스이므로 이 문서의 페이지 목록에서 제외했다.

## 7. 페이지가 아닌 사이트 정보·피드

| 리소스 | 확인 결과 |
|---|---|
| [robots.txt](https://www.naeo.kr/robots.txt) | HTTP 200, 수집 정책·사이트맵 주소 |
| [sitemap.xml](https://www.naeo.kr/sitemap.xml) | HTTP 200, URL 32개 |
| [llms.txt](https://www.naeo.kr/llms.txt) | HTTP 200, 서비스 소개·주요 링크 |
| [블로그 RSS](https://www.naeo.kr/blog/feed.xml) | HTTP 200, 글 20개 |
| [업데이트 RSS 안내 주소](https://www.naeo.kr/updates/feed.xml) | HTTP 308 → `/updates?focus=feed.xml`; RSS 본문 확인 안 됨 |

## 8. 수집 범위와 근거 파일

- 같은 사이트의 공개 페이지 내부 링크를 새 URL이 더 나오지 않을 때까지 대조했다. 관리자·회원·인증·결제·제작 화면은 배포 경로만 수록했다.
- 현재 배포 JS의 `_sentryRouteManifest` 원문을 다시 내려받아 정적 54개·동적 4종을 추출했다. 단순 문자열 검색으로 발견되는 라이브러리 예제 경로나 Next.js 내부 경로는 제외했다.
- 공개 사이트맵의 32개 URL이 목록에 전부 포함됐고, 블로그 RSS의 20개 글도 모두 포함됐다.
- 세션·게시글 ID에 따라 만들어지는 모든 비공개 URL까지 공개 자료로 확정할 수는 없다. 이 문서는 **공개 근거에서 발견한 전체 경로와 URL 목록**이다.
- 로그인·결제·데이터 변경 요청은 실행하지 않았다.

| 근거 | 파일 |
|---|---|
| 전체 URL·제목·상태·수집 원문·해시 | [pages.json](evidence/page-discovery/pages.json) |
| 배포 라우트 정의 | [route-manifest.json](evidence/page-discovery/route-manifest.json) |
| 라우트 원본 URL·해시·바이트 위치 | [route-manifest-provenance.json](evidence/page-discovery/route-manifest-provenance.json) |
| 사이트맵 원문 | [sitemap.xml](evidence/page-discovery/sitemap.xml) |
| robots 원문 | [robots.txt](evidence/page-discovery/robots.txt) |
| 블로그 RSS 원문 | [blog-feed.xml](evidence/page-discovery/blog-feed.xml) |

결과물 폴더: `/Users/user01/Desktop/NAEO/reverse-engineering`
