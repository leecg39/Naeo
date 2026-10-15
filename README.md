# NAEO 클론 · 풀스택 검증 현황

[전체 작업](TASKS.md) · [검증 기록](docs/fullstack/verification.md) · [운영 안내](docs/fullstack/operations.md) · [최종 감사](docs/fullstack/final-audit.md)

NAEO의 79개 구체 URL과 4개 동적 경로를 바탕으로 만든 로컬 재현 프로젝트입니다. 캡처한 DOM·CSS를 React로 렌더링하고 SQLite의 실제 계정·콘텐츠·작업·결제 모델에 연결합니다. 외부 연동과 일부 요구사항이 남아 있어 전체 완료 또는 운영 준비 완료로 표시하지 않습니다.

## 구현된 기능

- 계정: [이메일 인증·비밀번호 복구](docs/fullstack/account-mail.md) API·작업자·화면(외부 수신 검증 대기), 이메일 가입·로그인·세션·약관 동의, 프로필·블로그·연락처·알림 설정, 비밀번호 변경·세션 철회·탈퇴, 관리자 사용자 관리·감사 로그. [개인 데이터 내보내기](docs/fullstack/personal-data-export.md)는 42개 데이터셋·소유 첨부를 재인증 후 TAR로 제공합니다.
- 콘텐츠: 매거진·카테고리·정책·FAQ·업데이트·공지·고정 페이지 CMS, 버전 충돌 검사·이력 복구·발행/비공개, 문의·답변·답변 템플릿.
- 분석: 네이버 RSS 수집, 지속 작업 큐와 재시도, `rules-v1` 진단·근거·할 일·리포트·공유, 키워드·추천·경쟁 블로그. AI 인용 여부는 공급자 미설정으로 표시합니다.
- 작성: 초안 CRUD·버전 복구·템플릿, 개인 사진 업로드·다운로드·공유 철회, 안전한 HTML/Markdown/텍스트 내보내기. AI 글 생성 어댑터·작업 큐·멱등 차감·실패 환급은 구현되었고 실제 공급자 호출은 키가 필요합니다.
- 랭킹·이벤트: 기간별 스냅숏·동점 규칙·공개 설정, 이벤트·참여·심사·보상·회수·쿠폰·원장.
- 포인트·시작 가이드: 별도 원장·KST 출석·단계별 수령·서브 주제 CRUD. AI 인용/휴대폰 인증 단계는 공급자 연결 전까지 잠금입니다. [REA 반영 계획](docs/fullstack/engagement-plan.md).
- 요금제·결제: 체험·쿠폰·기간 지급/소멸·해지/재개, 토스 주문·승인·웹훅 재조회·환불·회계 기록 보호. 미확정 승인 조회·중단 환불 복구를 포함합니다. [서버 강제 종료/복구 검증](docs/fullstack/payment-recovery.md)과 실제 샌드박스 검증을 구분합니다.
- 연동·제작: Google/네이버 OAuth 어댑터, OAuth 동의·확장 연결·철회, MCP 도구 6개, 소셜 프로젝트·슬라이드 CRUD, PNG/PDF/ZIP 내보내기, 소유자 미리보기·관리자 개발 화면.
- 운영: 개인정보를 최소화한 방문 집계, 서비스/작업자 상태, 보관 정책, 일관된 DB 백업·업로드 복사·검증 후 복원.

## 실행

Node.js는 `package.json`의 `engines`(`^22.16.0 || >=24.0.0`)를 따릅니다. 검증 환경은 Node 25.4.0입니다. SQLite 파일과 업로드 폴더를 보존하는 서버에서 실행하세요.

```bash
npm ci
cp .env.example .env.local
# .env.local의 주소·DB·업로드 경로를 환경에 맞게 설정
npm run build
npm start
```

작업자는 별도 터미널에서 같은 환경 변수로 `npm run worker`를 실행합니다. CLI 실행 시 환경 파일을 자동으로 읽지 않으므로, `.env.local`을 사용하는 경우 `node --env-file=.env.local --import tsx scripts/worker.ts`로 실행하세요. 기본 웹 주소는 `http://127.0.0.1:3000`입니다. 인계받은 QA 서버는 별도 DB로 `http://127.0.0.1:3100`에서 실행합니다.

`/login`에서 가입한 뒤 `npm run admin -- promote 이메일`로 관리자로 승격하고 다시 로그인합니다. CLI에도 웹과 동일한 DB 환경 변수를 전달해야 합니다. 기본 관리자나 공유 비밀번호는 만들지 않습니다.

## 검증

```bash
npm test
npm run lint
npm run typecheck
npm run build
# 실행 중인 QA 서버의 HTTP 접근 규칙 감사(관리자 계정은 환경 변수)
npm run audit:routes
# Ego Lite에서 기존 인계 작업 공간을 재사용, batch 0~8 각각 실행
node scripts/run-browser-qa.mjs 0
```

HTTP 감사 변수는 `NAEO_AUDIT_EMAIL`, `NAEO_AUDIT_PASSWORD`, 선택적 `NAEO_AUDIT_BASE`입니다. 비밀번호를 명령 기록이나 저장소에 적지 마세요. 브라우저 검증은 관리자 로그인 상태의 Ego 작업 공간을 사용합니다(`NAEO_QA_SPACE`, 기본 7). [경로 증거](docs/fullstack/page-coverage.json)와 [브라우저 결과](docs/fullstack/browser-qa/)에 범위와 제한을 기록합니다.

`scripts/qa-browser.mjs`와 기존 캡처용 스크립트는 초기 데모 단계 자료이므로 현재 풀스택 기능 검증에는 사용하지 않습니다. 앱의 localStorage에는 테마·공지 닫기 등 브라우저 편의 상태만 남겨 두었습니다.

## 남은 구현·검증

메일 기반 비밀번호 재설정·이메일 인증·실제 알림 발송, SMS 인증, AI 인용/검색 지표 공급자, AI 이미지 생성은 추가 연동 구현이 필요합니다. Anthropic 글 생성, 토스 결제, Google/네이버 로그인은 실제 키·앱 등록 후 공급자 왕복 검증이 필요합니다. 실제 확장 프로그램 코드는 이 저장소에 없고, 배포 URL에서 ChatGPT·Claude 연결도 미검증입니다. MP4 인코딩은 지원하지 않습니다. 자세한 항목은 [최종 감사](docs/fullstack/final-audit.md)를 확인하세요.

소셜 견본과 소개 영상의 캡처 콘텐츠는 유지하며, `/social/banner-preview`는 캡처 부재로 홈으로 이동합니다. 원본에서도 없었던 대시보드 가이드 이미지 5개는 현재도 404로 표시됩니다. 원본 대비 전 화면 시각적 일치 검증은 완료하지 않았습니다.

이 프로젝트는 NAEO 공식 서비스가 아닙니다. 실제 운영 전에 원본에서 가져온 정책·FAQ·기사, 브랜드·SNS 링크·연락 메일, 요금제 가격과 혜택을 교체·확정해야 합니다.

## 구조

`src/data/pages`·`src/components/captured`는 캡처 화면, `src/behaviors`는 화면 상호작용, `src/components`는 API와 연결된 UI, `src/server`는 DB·도메인·API·공급자, `scripts`는 운영·검증, `docs/fullstack`은 계약·설계·증거를 담습니다. `var`의 DB·업로드·백업 및 환경 비밀값은 Git에서 제외합니다.

최신 적대적 QA와 반복 개선 결과: [감사 보고서](docs/audit/audit-report-2026-10-14.md). 요청 스트림 제한·사진 삭제 자동 복구·외부 앱 접근 철회 보강과 293개 회귀 테스트를 포함한다.
