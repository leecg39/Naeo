# Codex 인계 문서 (Claude Code → Codex)

Claude Code가 사용 한도에 걸리면 Codex가 이 문서만 보고 이어서 작업한다. 커밋할 때마다 갱신한다.
마지막 갱신: 2026-10-14, 커밋 `020a5e9` 이후 작업 중.

## 목표(사용자 원문 요지)
clone-website로 만든 naeo.kr 복제본에 REA 역공학 분석대로 **전 메뉴 페이지의 데이터 모델·CRUD·화면·백엔드**를 구현하고, 추론하지 말고 실제로 작동하는지 하나씩 검증한다. 계획은 `TASKS.md`(P0–P8), 설계는 `docs/fullstack/*.md`.

## 꼭 지킬 규칙
- 답변은 한국어, 결론 먼저. 날짜·요일 계산은 반드시 `date`/python으로.
- TDD: 테스트 먼저(RED) → 구현(GREEN). 회귀 테스트는 버그 버전에서 실패하는지 확인.
- zod 검증, 불변 객체, 파일 800줄·함수 50줄 이하, 비밀값 하드코딩 금지.
- 증거 기반 완료: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`를 실제로 돌리고 결과를 기록.
- 외부 연동 키가 없으면 '미설정'으로 표시하고 결과를 꾸며내지 않는다(결제·OAuth·AI·메일·SMS).
- naeo.kr 원문을 응답에 옮기지 않는다. 시드의 원문(정책 문서·FAQ·기사)은 실제 운영 전에 교체해야 한다.
- 커밋 전 스테이징 diff에서 비밀값 검사(`git diff --cached`에서 API 키 형식 `sk-ant-`·`sk-proj-`와, 사용자에게 받은 QA 비밀번호 문자열을 검색). QA 계정 정보는 어떤 파일에도 적지 않는다.
- 커밋 메시지: conventional commits, 끝에 `Co-Authored-By` 줄. 커밋 후 `git push origin main`.
- Next.js 16.4는 학습 데이터와 다르다. 코드 작성 전 `node_modules/next/dist/docs`를 확인.
- `npm run lint`는 디렉터리를 명시한다. 새 디렉터리를 만들면 `package.json`의 lint와 `eslint.config.mjs`의 files에 추가.

## 실행·검증 환경
- 프로젝트: `/Users/user01/Desktop/NAEO/naeo-clone`, 원격 `https://github.com/leecg39/Naeo.git` (main).
- QA 서버(포트 3100, 3000은 다른 서버라 건드리지 않음):
  `NAEO_APP_URL=http://127.0.0.1:3100 NAEO_DATABASE_PATH=var/qa/foundation.sqlite NAEO_UPLOAD_DIR=var/qa/uploads nohup node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100 > var/qa/server-3100.log 2>&1 &`
  재시작: `lsof -ti tcp:3100 -sTCP:LISTEN`로 PID 확인 후 종료. 상태: `curl http://127.0.0.1:3100/api/health`.
- 작업자: `NAEO_DATABASE_PATH=var/qa/foundation.sqlite NAEO_UPLOAD_DIR=var/qa/uploads NAEO_WORKER_IDLE_MS=1000 nohup node --import tsx scripts/worker.ts > var/qa/worker.log 2>&1 &` (코드 바꾸면 재시작).
- QA DB 스냅숏은 서버 실행 중엔 파일 복사 대신 `VACUUM INTO`로 만든다(WAL 누락 방지). `var/`는 git 제외.
- 브라우저 검증: ego-browser(task space 7, page p1). 관리자 계정으로 로그인되어 있다(계정 정보는 저장소 밖에서 사용자에게 확인).
- 외부 키가 필요한 흐름은 로컬 스텁(커밋하지 않음)으로 실제 HTTP 왕복을 검증했다: 토스 결제(`NAEO_TOSS_API_BASE`), OAuth(`NAEO_OAUTH_ENDPOINT_BASE`, localhost만 허용).

## 완료 현황
P0–P6 대부분 완료(체크 상태는 `TASKS.md`가 기준). 최근 커밋: P5 이벤트·리워드 `9f5208a`, P6 결제 `eb04d49`, P7.1 OAuth 로그인 `020a5e9`.
키가 없어 미완료로 남긴 항목: P1.6(메일), P1.7(SMS), P1.8(스크린샷 비교), P3.3/P3.7(AI 인용), P4.2(실제 Anthropic 왕복), P6.3/P6.5(실제 토스 샌드박스), P7.1(실제 Google·네이버 앱 왕복).

## 지금 하던 작업: P7.2 + P7.3 (OAuth 인가 서버 + MCP)
완료(커밋 예정/완료 확인은 `git log`):
- 마이그레이션 22: `oauth_clients`, `oauth_codes`, `oauth_tokens`, `mcp_calls`.
- `src/server/oauth/authz.ts`: 동적 클라이언트 등록(RFC 7591), 확장 클라이언트(`naeo-extension-{id}`, `https://{id}.chromiumapp.org/`), 동의 요청 검증, 일회 코드(5분), PKCE S256, `resource`(RFC 8707, `{origin}/api/mcp`) 고정, 접근 토큰 1시간·리프레시 30일 회전·재사용 시 계열 철회, Bearer 검증, 철회(RFC 7009), 연결된 앱 목록·해제.
- 테스트 `tests/server/oauth-server.test.ts` 4/4 통과.

남은 일(순서대로):
1. HTTP 연결(`src/server/api.ts`에 연결, Origin 검사 예외는 서버 간 호출인 token·register·revoke·mcp만):
   `POST /api/oauth/register`, `POST /api/oauth/token`(form-urlencoded, 오류는 `{error,error_description}`), `POST /api/oauth/revoke`, `POST /api/oauth/authorize`(동의 화면에서 호출, 회원+Origin 필요, `{redirect}` 반환), 회원 `GET /api/account/apps`, `DELETE /api/account/apps/:clientId`.
2. 메타데이터 라우트(문서 확인됨: `app/.well-known/.../route.ts` 지원): `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`와 `/.well-known/oauth-protected-resource/api/mcp`.
3. `/oauth/consent` 화면: 로그인 필요(next에 전체 쿼리), 클라이언트·리디렉션 오류는 캡처 오류 상자 그대로, 그 외 오류는 앱으로 돌려보냄, 앱 이름·범위(한국어)·승인/거부 버튼.
4. `/auth/extension?extension_id=&state=&code_challenge=&code_challenge_method=S256`: `NAEO_EXTENSION_IDS`(쉼표 구분)에 있으면 확장 클라이언트를 만들고 `/oauth/consent`로 이동, 아니면 캡처 오류 상자.
5. 설정에 '연결된 앱'(이름·범위·연결일·마지막 사용·호출 수·연결 해제).
6. `/api/mcp`(Streamable HTTP, 명세 2025-06-18 확인): POST JSON-RPC 단건, `initialize`(버전 협상), `notifications/*`→202, `ping`, `tools/list`, `tools/call`. 토큰 없거나 잘못되면 401 + `WWW-Authenticate: Bearer resource_metadata="{origin}/.well-known/oauth-protected-resource/api/mcp"`. 다른 사이트 Origin은 403, GET은 405. 도구: 블로그 상태(read), 초안 목록·조회(read), 초안 만들기(write), 토큰 잔액(read), AI 글 생성 요청(generate, 키 없으면 isError '미설정'). 호출은 `mcp_calls`에 기록, 토큰별 속도 제한.
7. 테스트(HTTP·MCP), 문서(api-contracts·data-model·verification), TASKS 체크, Ego로 등록→동의→토큰→MCP 호출→해제 E2E, 390px 확인, 커밋·푸시.

## 그 다음
- P7.4 소셜 프로젝트/슬라이드 CRUD(/social/*, /youtube/aeo-intro), P7.5 이미지·PDF 내보내기와 /preview·/dev/* 권한, P7.6 E2E.
- P8: 분석·운영 문서·백업/복원, 83개 경로 증거(page-coverage.json), localStorage 데모 제거 감사(`src/lib/demo-store.ts`, `src/behaviors/settings.tsx`는 /dashboard/settings가 앱 라우트라 사용되지 않는 코드), 전체 검증, README/CHANGELOG.
- 마지막 보고: 한국어, 결과 파일 링크와 폴더 절대 경로, 키가 없어 막힌 항목 목록.
