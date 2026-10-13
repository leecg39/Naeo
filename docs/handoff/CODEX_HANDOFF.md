# Codex 인계 문서 (Claude Code → Codex)

Claude Code가 사용 한도에 걸리면 Codex가 이 문서만 보고 이어서 작업한다. 커밋할 때마다 갱신한다.
마지막 갱신: 2026-10-14, Claude 사용 한도 이후 Codex가 P8.5 검증·오류 수정·P8.6 문서 감사를 이어받음.

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
- 브라우저 검증: Ego Lite의 task space 7, p1에서 관리자 세션으로 실행했고 검증 후 `task.finish({keep:[]})`로 종료했다. 다음 실행에서는 새 작업 공간을 만들고 ID를 `NAEO_QA_SPACE`로 전달한다. 계정 정보를 저장소에 넣지 않는다.
- 외부 키가 필요한 흐름은 로컬 스텁(커밋하지 않음)으로 실제 HTTP 왕복을 검증했다: 토스 결제(`NAEO_TOSS_API_BASE`), OAuth(`NAEO_OAUTH_ENDPOINT_BASE`, localhost만 허용).

## 완료 현황

Claude 인계 기준 HEAD는 `0f55dba`(P8.2). P0–P8.4의 구현·검증 기록은 `TASKS.md`와 `docs/fullstack/verification.md`에 보존했다. 초기 인계 문서의 '그 다음 P7.4/P7.5' 안내는 이미 완료된 내용이라 삭제했다.

Codex가 이어서 처리한 작업:
- 미커밋 `src/lib/kst-time.ts`·테스트를 인계, `/admin/blog`의 React #418을 재현하고 공통 KST 포맷을 실제 화면에 연결.
- locale 차이·연도 경계·윤일 회귀 테스트, 글쓰기 UI lint 범위 보강 및 렌더 중 시각 계산 제거.
- 90개 경로 × 3개 화면 폭 점검, 6개 경로의 가로 넘침 수정. 원본 1080px 내보내기 캔버스는 내부 스크롤로 유지.
- 최신 검증 수치와 증거는 `docs/fullstack/browser-qa/summary.json`, `verification.md`의 P8.5 기록을 기준으로 한다.
- P8.4 추가 결함 수정: 대시보드 공통 메뉴의 잔액·체험·프로필과 글쓰기의 추천·구독 정보를 현재 회원 DB로 연결.
- README·CHANGELOG·최종 감사·운영 안내 갱신. 프로젝트 전체 완료 판정은 보류.

## 다음 작업

`docs/fullstack/final-audit.md`의 남은 항목 표를 기준으로 진행한다. 키 입력만 필요한 항목과 공급자 어댑터 자체가 없는 항목을 구분한다.

- 메일 재설정·이메일 인증, SMS 인증, AI 인용/검색 지표, AI 이미지 생성: 공급자 선정 및 구현 필요.
- Anthropic 글 생성, 토스 결제, Google/네이버 OAuth: 실제 키·앱 등록 후 왕복 검증 필요.
- 실제 확장 코드·등록 ID, 배포 주소의 ChatGPT/Claude MCP 연결: 추가 자료/환경 필요.
- 전체 원본 화면 시각 비교, MP4 인코딩 요구사항: 미완료/미지원 상태를 유지.
- 원본 정책·FAQ·기사·브랜드 연락처·SNS와 요금제 운영값 교체.

외부 검증이 남아 있으므로 P8.6과 프로젝트 전체를 완료로 바꾸지 않는다. goal은 사용자가 해제를 요청했으므로 별도 활성화하지 않는다.

## 재현 명령

`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
Ego 점검은 `node scripts/run-browser-qa.mjs 0`부터 `8`까지. 이 실행기는 셸 설정을 Ego 내부 Node로 전달한다. 원시 브라우저 코드를 셸 환경 변수만 붙여 실행하면 배치 번호가 전달되지 않을 수 있다.

최종 보고에는 한국어로 현재 완료 범위·미완료 범위를 구분하고, 결과 파일과 결과 폴더의 절대 경로 링크를 제공한다.
