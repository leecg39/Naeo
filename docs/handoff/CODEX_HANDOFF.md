# Codex 인계 문서 (Claude Code → Codex)

Claude Code가 사용 한도에 걸리면 Codex가 이 문서만 보고 이어서 작업한다. 커밋할 때마다 갱신한다.
마지막 갱신: 2026-10-14, 사용자 요청으로 적대적 QA·RSI 작업을 일시 중지하고 현재 상태를 커밋·푸시하는 체크포인트를 작성함.


## 2026-10-15 목표 재개 및 REA 후속 작업

사용자 활성 목표 계속 실행 요청에 따라 작업을 재개했다. 아래의 2026-10-14 일시 중지 기록은 과거 체크포인트다. 전체 목표는 active이며 완료가 아니다.

- P10 포인트·출석·튜토리얼·서브 주제 CRUD·DB/UI 구현과 HTTP 검증을 추가했다. `docs/fullstack/engagement-plan.md`, `verification.md`의 P10, `evidence/engagement-http.json` 참조.
- 마이그레이션 27. 원본과 구분한 로컬 출석 정책은 매일 5P + 연속 7일마다 15P. AI 인용·SMS 단계는 잠금 유지.
- P10.3 브라우저 QA 미완료: 기존 Ego 공간 15가 없어 새 공간 생성 확인을 요청했다. 임의로 다른 사용자 공간을 쓰거나 새 공간을 생성하지 않는다.
- 로컬 QA 서버는 이번 실행의 3110 / `var/qa/engagement.sqlite`를 사용했다. 기존 3100과 분리했다. 검증 계정은 삭제했고 자격증명을 저장하지 않았다.
- 다음은 P10.3(승인 시)과 P9.2 결제/환불 초안 11건. 해당 `.pending` 테스트는 여전히 미구현이며 이번 변경으로 해결됐다고 세지 않는다. 전체 외부 공급자·확장·영상·시각 비교 범위를 유지한다.

## 2026-10-15 결제·환불 재개 결과

과거 `.pending` 초안을 `tests/server/adversarial-payments.test.ts`로 재개해 11건 실패를 확인하고 수정했다. 전용 테스트 20건과 실제 HTTP/서버 SIGKILL·재시작 복구 20항목을 확인했다. 스키마 28과 상세 계약/남은 한계는 `docs/fullstack/payment-recovery.md`를 따른다. 아래의 “구현 미착수” 및 `.pending` 경로는 과거 기록이며 현재 상태가 아니다.

다음은 P9.2 백업/복원·개인정보 이동성 및 기존 외부 제공자 미완료 작업이다. 브라우저 새 공간 승인 대기는 그대로다. 이번 QA의 3110/3112 서버는 종료했고 임시 결제 QA DB는 삭제했다.

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

외부 검증이 남아 있으므로 P8.6과 프로젝트 전체를 완료로 바꾸지 않는다. 적대적 QA·RSI까지 이어서 마무리하는 목표는 사용자 요청으로 현재 **paused**다. 사용자가 명시적으로 재개하기 전에는 구현·추가 QA를 진행하지 않는다. 전체 미완료 항목을 해결하기 전에는 완료 처리하지 않는다.

## 재현 명령

`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
Ego 점검은 `node scripts/run-browser-qa.mjs 0`부터 `8`까지. 이 실행기는 셸 설정을 Ego 내부 Node로 전달한다. 원시 브라우저 코드를 셸 환경 변수만 붙여 실행하면 배치 번호가 전달되지 않을 수 있다.

최종 보고에는 한국어로 현재 완료 범위·미완료 범위를 구분하고, 결과 파일과 결과 폴더의 절대 경로 링크를 제공한다.


## P9 최신 인계

`docs/audit/audit-report-2026-10-14.md`의 SEC-01~04·PRIV-01 수정, 293/293·lint·typecheck·build 통과. 실제 QA 서버/작업자는 스키마 26, 포트 3100을 사용한다. 사진 삭제 실패→작업자 재시도 복구와 관리자 390px 화면을 확인했다. 임시 데이터 정리 완료.

Ego 작업 공간 **15 / p1**은 일시 중지 시점에 열린 상태로 보존했다. 재개 후 다음 브라우저 작업은 이 공간을 재사용한다. 이전 공간 7은 종료된 상태다. QA 서버(3100)와 작업자는 이번 중지 요청으로 종료하지 않았다. 원래 미완료 외부 연동 범위를 축소하지 않는다.

### 일시 중지 체크포인트

- 사용자 요청: “일시 중지 해주고 커밋 푸시 해줘”. goal 상태는 `paused`이며 프로젝트 완료를 뜻하지 않는다.
- 마지막 구현·검증 완료 기준 커밋: `0447939d0e2a00ef6f82935758babbaf6440f4b1`. 당시 293/293·lint·typecheck·build 통과 기록은 기존 감사 보고서에 있다. 이번 체크포인트에서는 제품 코드를 바꾸거나 전체 검증을 다시 실행하지 않았다.
- `tests/server/adversarial-payments.test.ts.pending`에 결제·환불 재현 테스트 초안을 보존했다. 중지 전 실행 결과는 **11개 중 통과 0, 실패 11**이며 구현은 미착수다. `.pending` 확장자는 정상 테스트 실행 대상에 미완료 초안이 포함되지 않도록 한 것이다. 이 실패들을 해결된 결함이나 최종 확정된 계약으로 간주하지 않는다.
- 초안 범위: 결제 응답 식별자 대조, 승인 대기 중 주문 변경·만료·탈퇴, 웹훅 식별자 대조, 환불 응답 검증, 통신 실패·중단 후 동일 멱등키 재시도, 공급자 미설정 시 잔여 요청, 승인 결과 불명 시 재시도.
- 재개 시 `.pending`을 제거하고 `node --import tsx --test tests/server/adversarial-payments.test.ts`로 RED를 재확인한다. 공급자 계약과 테스트 기대값을 검토한 뒤 구현·회귀 검증을 진행한다. 백업/복원·개인정보 이동성 검토는 그다음이며 아직 미완료다.

### 2026-10-15 최신 상태 — 앞선 중지 기록 이후

- 현재 goal은 `active`다. 앞의 `paused`와 결제 초안 11건은 과거 체크포인트 기록이다.
- 결제·환불 복구는 `1a26826`에서 구현·푸시했다. 스키마 28, 전체 324개 테스트 및 lint/typecheck/build 통과. 상세는 `docs/fullstack/payment-recovery.md`를 따른다.
- 최신 사용자 요청 “REA로 역공학”에 따라 공개 청크 4개와 HTTP 관찰 6개를 추가 조사했다. `docs/fullstack/rea-deep-dive.md`와 근거 JSON에 MCP OAuth 발견 경로·문의·공지·업데이트 계약을 기록했다. 이번 변경은 문서·증거이며 제품 구현 변경이 아니다.
- Ego 공간 7·15는 현재 목록에 없다. 새 공간 생성 질문은 답변 대기 중이며 반복 질문하거나 다른 사용자 공간을 사용하지 않는다.
- 다음 구현 과제는 기존 P9.2 백업·복원·개인정보 이동성이다. 새 REA 결과가 외부 공급자·인증 대시보드·MCP 실연동을 완료한 것으로 해석하지 않는다.

### P9.2 백업·복원 보강 이후

- 현재 goal은 계속 active이며 바로 앞 REA 턴도 실제 Evidence/HTTP 관찰과 커밋을 만든 progress였다.
- 백업 결함 5건을 재현하고 수정했다. 형식 2의 업로드별 SHA-256, 읽기 전용 SQLite 무결성·외래키·마이그레이션 검사, 임시 사본에서 마이그레이션, 보존 사본 덮어쓰기 차단을 구현했다.
- 복원 journal과 서버 DB 연결 차단, 오류 롤백, 실제 SIGKILL 이후 `restore --offline --recover` 복구를 확인했다. 파일 수 0인 유효한 구형 백업은 호환된다. 기존 QA 백업 1개는 외래키 위반 5건으로 거절됐고 원본은 유지했다.
- 최종 339개 테스트(6+333), 전용 17개, lint/typecheck/build 통과. 스키마는 28 그대로다. `docs/fullstack/backup-recovery.md` 및 evidence 로그를 따른다.
- 백업/복원 CLI에는 `--offline`이 필요하다. 이 옵션은 운영자가 기록기를 멈췄다는 확인이며 자동 프로세스 종료·완전한 온라인 스냅샷 기능이 아니다. 사용자 앱·실제 QA DB에 이번 복원을 실행하지 않았고 격리된 임시 DB와 프로세스로 검증했다.
- 다음: 개인정보 내보내기 계약·소유 데이터 및 첨부 파일 범위 조사 → 본인 재인증/세션·소유권 검증 → 다운로드 API·계정 화면 → 타 계정/비밀값 노출 방지와 실제 HTTP 다운로드 검증. P9.2와 외부 공급자·Ego 검증의 미완료 범위를 유지한다.

### P9.2 개인 데이터 내보내기 이후 — 최신

- 스키마 29. 41개 데이터셋과 소유 사진·제작 파일을 TAR로 내보내는 API, worker, 계정 화면 구현. 원본 REA에서 관찰한 기능이라고 주장하지 않는 별도 설계다.
- 비밀번호 재인증 또는 비밀번호 없는 소셜 계정의 최근 로그인, 세션/계정 소유권, snapshot 후 publish fencing, 1시간 TTL, durable 삭제 큐/공정 재시도 구현. `result_json` 수집 이력도 포함한다.
- 전용 18개·전체 357개(6+351), lint/typecheck/build 통과. 실제 Next 서버/worker로 요청·다운로드·다른 계정 차단·시스템 TAR 파싱·파일 해시 및 로그아웃 후 재시작 삭제를 확인했다.
- 폴더 EACCES가 전체 worker를 죽이던 문제와 앞 100개 삭제 실패가 뒤의 정상 행을 굶기던 문제는 각각 RED 후 수정했다. 자세한 계약/근거: `docs/fullstack/personal-data-export.md`.
- 격리 QA 서버/worker/임시 데이터는 정리했다. 사용자 DB나 기존 서버를 수정하지 않았다.
- goal은 active. P9.2는 새 UI의 Ego 클릭/hydration 검증 때문에 미완료 유지. 기존 공간 부재와 새 공간 질문 답변 대기는 그대로다. 독립 구현 가능한 다음 과제: 이메일 재설정/이메일 확인 공급자 어댑터와 상태·화면·실제 로컬 왕복 검증. SMS/AI 인용·이미지 등 나머지 외부 기능과 전체 원본 시각 비교 범위를 축소하지 않는다.
