# 풀스택 검증 기록

## 2026-10-13 — 기반 구현

환경: Node 25.4.0, Next 16.4.0, SQLite(node:sqlite). 실제 production build를 `127.0.0.1:3100`에서 실행하고 별도 `var/qa/foundation.sqlite`로 브라우저를 검증했다. 원본 NAEO 서버에는 쓰기를 수행하지 않았다.

### 실행 결과

| 명령·검증 | 결과 | 범위 |
|---|---|---|
| `npm test` | 20/20 통과 | 기존 캡처 데이터 5, 전체 범위 계획 1, 서버/HTTP 14 |
| `npm run lint` | exit 0 | 새 서버·계정 화면·관련 테스트/CLI. 기존 데모 adapter 전체 정적 감사는 P8 |
| `npm run typecheck` | exit 0 | 전체 TypeScript |
| `npm run build` | exit 0 | production build, API·로그인·계정 설정은 dynamic |
| DB 파일 닫기/재열기 | 통과 | 블로그와 세션 보존, 마이그레이션 중복 적용 없음, 파일 권한 0600 |
| FK/CHECK·트랜잭션 | 통과 | FK 위반/허용되지 않은 역할 거절, 실패 시 프로필 변경 롤백 |
| 인증 | 통과 | 이메일 정규화·중복, 비밀번호/세션 해시 저장, 기본 member, 잘못된 암호/정지 계정/변조·만료 세션 거절 |
| HTTP·권한 | 통과 | 401/403/404/409/413/415/429, Origin·body·입력 필드 제한, 두 사용자 블로그 격리 |
| 실제 Ego UI | 통과 | 미인증 리다이렉트 → 회원가입 → 프로필 변경 → 블로그 생성/조회/수정 → 로그아웃/재로그인 → 서버 재시작 보존 → 삭제 확인 → 재조회 빈 목록 |
| 관리자 초기 지정 CLI | 통과 | 별도 QA DB의 기존 계정에 `npm run admin -- promote` 실행 후 `/api/auth/me`의 role=admin 확인. 관리자 CRUD UI는 미구현 |
| 반응형 DOM | 통과 | 1440px: scrollWidth 1425, 768px: 753, 390px: 390. 프로필·폼·빈 목록 존재 |
| 스크린샷 시각 비교 | 미완료 | Ego `Page.captureScreenshot` 시간 초과. screenshot wrapper와 직접 CDP 모두 실패. 이미지 결과물을 생성했다고 주장하지 않음 |

서버 테스트: `tests/server/foundation.test.ts`, `tests/server/http.test.ts`. 브라우저 실측: `evidence/foundation-browser.json`, `evidence/settings-after-crud.txt`. 스크린샷 시도 중 발생한 emulation 좌표 문제는 1440px override를 다시 설정해 회복했고, 이후 키보드와 포인터로 삭제 확인 흐름을 마쳤다. 최종 브라우저 공간은 7, 페이지 p1이며 전체 목표의 후속 검증에 재사용한다.

### 구현 상태와 아직 남은 범위

DB·마이그레이션·자체 가입/로그인·세션·로그아웃·프로필 조회/수정·블로그 CRUD·설정 UI를 구현했다. 관리자 승격 CLI는 있지만 사용자 관리 UI/CRUD는 아직 없다. 프로필 생성은 가입과 함께 이루어지며 탈퇴/삭제는 P1.6에서 이어서 구현한다.

비밀번호 변경/재설정, 메일·휴대폰 검증, 계정 탈퇴, 관리자 CRUD, 연락처·설정 확장은 남아 있다. P2–P8 콘텐츠·문의·수집/분석·추천·경쟁자·글쓰기·이미지·랭킹·이벤트·보상·결제·OAuth·MCP·소셜 내보내기도 미완료다. 과거 clone QA의 79 URL 성공은 이 기능들의 구현 완료를 뜻하지 않는다. `page-coverage.json`은 전체 요구가 끝나지 않은 경로를 pending 상태로 유지한다.

AI/OAuth/결제/SMS/메일 개발 설정은 미확인이다. 원본 로그인 세션이나 GitHub 로그인은 공급자 앱 설정을 대체하지 않는다. DB·CRUD 구현은 계속 진행할 수 있다.

## 2026-10-13 — P1 계정 보안·관리자 (P1.3, P1.5–P1.7)

환경: 동일 production build를 `127.0.0.1:3100`, `NAEO_DATABASE_PATH=var/qa/foundation.sqlite`로 실행. Ego 공간 7, 페이지 p1.

| 명령·검증 | 결과 | 범위 |
|---|---|---|
| `npm test` | 33/33 통과 | 기존 6 + 서버/HTTP/계정 27 |
| `npm run lint` / `npm run typecheck` / `npm run build` / `git diff --check` | 모두 exit 0 | 반응형 CSS 수정 후 재실행 |
| 약관 동의 | 통과 | 관리자 생성 계정 첫 로그인 → `/auth/terms` 동의 → 대시보드. SQLite 행 직렬화 오류 수정 후 재확인 |
| 권한 차단 | 통과 | 일반 회원 `/admin/users` 화면 403, API 차단 |
| 연락처·알림 | 통과 | 생성·수정·새로고침 보존·삭제(`contact_details` 0행, `contact.delete` 감사), 휴대폰은 "인증되지 않은 번호" 표시, 선택 수신 설정 보존 |
| 비밀번호·세션 | 통과 | 개별 세션 종료, 비밀번호 변경 후 이전 비밀번호 거부·새 비밀번호 로그인, 다른 기기 모두 로그아웃 |
| 회원 탈퇴 | 통과 | 재인증 탈퇴 후 `/api/auth/me` 401, 같은 계정 재로그인 401 |
| 관리자 CRUD | 통과 | 사용자 생성·닉네임 수정·정지/복구·검색, 삭제 시 이메일 불일치 거절, 정상 삭제 후 새로고침 목록에서 제거(총 1명) |
| 마지막 관리자 보호 | 통과 | 약관 미동의 관리자는 집계 제외. 유일한 동의 관리자 본인 강등 시 409 LAST_ADMIN, DB role 유지 |
| 반응형 | 수정 후 통과 | 수정 전 `/admin/users` 390px 레이아웃 폭 681(→622), 768px scrollWidth 961; `/admin` 922/1202. 원인: `.settings-sections` grid 열이 nowrap 표 폭으로 확장, 행 버튼의 `sr-only`(absolute)가 스크롤 컨테이너 밖으로 탈출. `admin.css`에 `grid-template-columns:minmax(0,1fr)`와 `.responsive-table{position:relative}` 추가. 수정 후 390/768/1440px 세 화면 모두 scrollWidth ≤ innerWidth, 표만 가로 스크롤 |
| 스크린샷 시각 비교 | 미완료 | Ego `Page.captureScreenshot` 시간 초과 지속 |

브라우저 기록: `evidence/account-security-browser.txt`, `evidence/admin-users-created-updated.txt`, `evidence/admin-audit-deletions.txt`, `evidence/account-responsive.json`, `evidence/admin-responsive.json`(반응형 수정 전 측정, 경로 미기재 — 위 표의 수정 후 수치가 최신).

미구현: 비밀번호 재설정 메일, 이메일 검증, SMS 휴대폰 인증, 이메일 알림 실제 발송. 메일·SMS 공급자 설정이 필요하며 저장 성공을 발송·인증 성공으로 간주하지 않는다.
