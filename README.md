# NAEO 클론 · 풀스택 구현 진행 중

[실행 화면](http://127.0.0.1:3000) · [원본 페이지 목록](../reverse-engineering/page.md) · [페이지별 구현 범위](docs/PAGES.md) · [검증 기록](docs/QA.md)

`reverse-engineering/page.md`의 79개 구체 URL과 4개 동적 패턴을 대상으로 구현합니다. 기존 캡처 화면 61개의 시각적 재구성을 바탕으로 서버 기능을 연결하고 있습니다. 전체 계획은 [TASKS.md](TASKS.md), [경로별 CRUD](docs/fullstack/page-crud-matrix.md), [설계](docs/fullstack/architecture.md), [검증](docs/fullstack/verification.md)에 기록합니다.

현재 실제 서버에 연결된 기능: 이메일 가입/로그인/로그아웃, 약관 동의·권한 검사, 프로필·블로그·연락처 관리, 알림 수신 설정, 비밀번호 변경·로그인 세션 철회·회원 탈퇴, 관리자 사용자 CRUD·감사 로그. 데이터는 SQLite 파일에 보존됩니다. 분석·작성·문의·랭킹·결제·OAuth 등은 후속 단계이며 아직 전체 풀스택 완료 상태가 아닙니다.

## 실행

```bash
cd /Users/user01/Desktop/NAEO/naeo-clone
npm install
cp .env.example .env.local
npm run build
npm start
```

Node.js 22.16 이상(node:sqlite 지원)이 필요합니다. 검증 환경은 Node 25.4.0입니다. 서비스 주소를 바꾸면 `NAEO_APP_URL`도 같은 origin으로 설정하세요. 기본 DB는 `var/naeo.sqlite`이며 Git에서 제외합니다. 지속 볼륨이 없는 serverless 환경에 배포하지 마세요.

개발: `npm run dev` · 타입 검사: `npm run typecheck` · 새 서버/계정 UI 정적 검사: `npm run lint` · 테스트: `npm test`. 기존 `scripts/verify-routes.mjs`는 로그인 전 접근이 가능했던 클론용 검사라 변경된 인증 경로를 포함하는 전체 기능 완료 증거로 사용하지 않습니다.

먼저 `/login`에서 계정을 만드세요. 관리자로 사용할 기존 계정은 `npm run admin -- promote 이메일`로 명시적으로 승격할 수 있습니다. 승격하면 기존 세션이 종료되므로 다시 로그인한 뒤 `/admin/users`에서 사용자를 관리하세요. 기본 관리자 계정이나 공유 비밀번호는 생성하지 않습니다. 마지막 활성·약관 동의 관리자는 삭제·정지·권한 강등할 수 없습니다. 관리자가 만든 새 계정도 본인이 첫 로그인 때 약관에 동의해야 합니다.

비밀번호 재설정 메일, 이메일·휴대폰 검증, 이메일 알림의 실제 발송과 자동 스캔 실행은 후속 단계입니다. 저장한 휴대폰 번호를 인증된 것으로 표시하지 않습니다. 개인정보 변경·삭제 및 관리 작업에는 현재 비밀번호 재확인과 수정 버전 검사를 적용합니다.

## 구조

- `src/data/pages/`: 실제 페이지의 텍스트, SVG, DOM 구조와 CSS를 추출한 데이터. 이미지로 화면을 덮지 않고 React DOM으로 렌더링합니다.
- `src/components/captured/`: 노드 렌더러, 공통 테마·모달·메뉴·아코디언.
- `src/behaviors/`: 홈·메이트, 매거진·업데이트·문의, 랭킹, 분석, 추천, 글쓰기, 설정의 로컬 동작.
- `src/server/`: 버전 마이그레이션, 관계형 DB, 인증·세션·약관, 프로필·블로그·연락처·알림·관리자 서비스, HTTP 검증·권한·rate limit.
- `src/components/account/`: 실제 API와 연결된 로그인·회원가입·설정 화면.
- `src/components/admin/`: 사용자 CRUD·검색·상태·권한 관리, 감사 로그 화면.
- `src/components/StatefulExperience.tsx`: ChatGPT/Claude 연결 안내, 소셜 캐러셀 10장, AEO 영상 23장.
- `public/assets/`: 내려받은 이미지·영상·폰트·아이콘. 원본 SVG 134종은 `public/assets/icons/`에 있습니다.
- `docs/research/components/`: 구현 전 작성한 컴포넌트 명세. `docs/research/BEHAVIORS.md`: 동작 근거.
- `docs/design-references/`: 원본과 로컬 화면의 데스크톱·태블릿·모바일 비교 자료.
- `scripts/`: 수집·변환·자산 다운로드·URL 검사·Ego 브라우저 검증 스크립트.

## 동작과 범위

탭, 검색, 분류, 표 정렬, 아코디언, 캐러셀, 모바일 메뉴, 입력 검증, 이미지 선택, 샘플 글 생성·편집·저장·복사·다운로드를 사용할 수 있습니다. 상태는 `naeo-clone:` 접두어의 브라우저 localStorage에 저장합니다.

위에 명시한 실제 계정·관리 기능을 제외한 기존 adapter는 아직 데모입니다. AI 분석·생성, 결제, 문자 발송, 문의 전송은 연결하지 않았습니다. 남은 데모 코드를 각 단계에서 교체하며, 이를 실제 성공으로 간주하지 않습니다. 원본 계정 정보는 화면 데이터에서 예시 값으로 치환했습니다.

원본 관리자 내부 기능은 접근할 수 없어 신규 설계했습니다. `/admin`과 `/admin/users`는 실제 서버에 연결했고, 나머지 관리자 메뉴는 후속 구현 전까지 관리자 권한 확인 후 404로 응답합니다. Google 인증은 외부 Google 로그인 대신 로컬 로그인으로 연결합니다. `/preview`는 저장된 로컬 초안을 관리하는 데모 화면입니다.

랭킹 데이터는 조사 시점의 200명입니다. 월간·주간·더보기는 미수집 데이터를 실제 최신 데이터처럼 만들지 않고 데모 범위를 안내합니다. 원본의 긴 AI 글쓰기 시연 애니메이션 일부는 정적 캡처로 유지합니다. 라이트 테마·미관찰 모달은 공통 토큰으로 근사했습니다.

원본 서버에서 404로 응답한 대시보드 가이드 이미지 5개는 대체 이미지로 꾸미지 않고 기존 공간과 대체 텍스트를 유지합니다. 이 클론은 NAEO 공식 서비스가 아닌 로컬 재현물입니다.
