# Codex 인계 문서 (Claude Code → Codex)

Claude Code가 사용 한도에 걸리면 Codex가 이 문서만 보고 이어서 작업한다. 커밋할 때마다 갱신한다.
마지막 갱신: 2026-10-14, P7.3까지 커밋.

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

## 지금 하던 작업
P7.2·P7.3 완료(OAuth 인가 서버, 동의 화면, 확장 진입점, 연결된 앱, /api/mcp). 다음은 P7.4.
주의: QA DB를 스냅숏으로 되돌려 브라우저(ego) 로그인 세션이 없다. 브라우저 검증 전 관리자 계정으로 다시 로그인해야 한다(계정 정보는 사용자에게 확인).

## 그 다음
- P7.4 소셜 프로젝트/슬라이드 CRUD(캡처 /social/*·/youtube/aeo-intro 구조부터 확인, 마이그레이션 23)(/social/*, /youtube/aeo-intro), P7.5 이미지·PDF 내보내기와 /preview·/dev/* 권한, P7.6 E2E.
- P8: 분석·운영 문서·백업/복원, 83개 경로 증거(page-coverage.json), localStorage 데모 제거 감사(`src/lib/demo-store.ts`, `src/behaviors/settings.tsx`는 /dashboard/settings가 앱 라우트라 사용되지 않는 코드), 전체 검증, README/CHANGELOG.
- 마지막 보고: 한국어, 결과 파일 링크와 폴더 절대 경로, 키가 없어 막힌 항목 목록.
