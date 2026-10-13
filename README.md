# NAEO 로컬 클론

[실행 화면](http://127.0.0.1:3000) · [원본 페이지 목록](../reverse-engineering/page.md) · [페이지별 구현 범위](docs/PAGES.md) · [검증 기록](docs/QA.md)

`reverse-engineering/page.md`의 79개 구체 URL을 Next.js + React + TypeScript로 재구성했습니다. 61개 경로에 화면이 있고, 18개 주소는 인증·권한·이전 주소에 따른 리디렉션입니다. 동적 이벤트와 이미지 경로도 처리합니다.

## 실행

```bash
cd /Users/user01/Desktop/NAEO/naeo-clone
npm install
npm run build
npm start
```

개발: `npm run dev` · 타입 검사: `npm run typecheck` · 데이터 검사: `npm test` · 서버 실행 후 URL 검사: `node scripts/verify-routes.mjs`.

## 구조

- `src/data/pages/`: 실제 페이지의 텍스트, SVG, DOM 구조와 CSS를 추출한 데이터. 이미지로 화면을 덮지 않고 React DOM으로 렌더링합니다.
- `src/components/captured/`: 노드 렌더러, 공통 테마·모달·메뉴·아코디언.
- `src/behaviors/`: 홈·메이트, 매거진·업데이트·문의, 랭킹, 분석, 추천, 글쓰기, 설정의 로컬 동작.
- `src/components/StatefulExperience.tsx`: ChatGPT/Claude 연결 안내, 소셜 캐러셀 10장, AEO 영상 23장.
- `public/assets/`: 내려받은 이미지·영상·폰트·아이콘. 원본 SVG 134종은 `public/assets/icons/`에 있습니다.
- `docs/research/components/`: 구현 전 작성한 컴포넌트 명세. `docs/research/BEHAVIORS.md`: 동작 근거.
- `docs/design-references/`: 원본과 로컬 화면의 데스크톱·태블릿·모바일 비교 자료.
- `scripts/`: 수집·변환·자산 다운로드·URL 검사·Ego 브라우저 검증 스크립트.

## 동작과 범위

탭, 검색, 분류, 표 정렬, 아코디언, 캐러셀, 모바일 메뉴, 입력 검증, 이미지 선택, 샘플 글 생성·편집·저장·복사·다운로드를 사용할 수 있습니다. 상태는 `naeo-clone:` 접두어의 브라우저 localStorage에 저장합니다.

실제 로그인, AI 분석·생성, 결제, 문자 발송, 문의 전송은 연결하지 않았습니다. 인증은 데모 계정, 글 생성·분석은 샘플 결과, 연락처 인증 코드는 `123456`, 데모 쿠폰은 `NAEO-DEMO`입니다. 원본 계정 정보는 화면 데이터에서 예시 값으로 치환했습니다.

관리자 11개 주소는 현재 계정에서 확인 가능한 홈 이동/접근 제한 범위를 재현했습니다. 관리자 내부 기능은 확인할 수 없어 복제하지 않았습니다. Google 인증은 외부 Google 로그인 대신 로컬 로그인으로 연결합니다. `/preview`는 저장된 로컬 초안을 관리하는 데모 화면입니다.

랭킹 데이터는 조사 시점의 200명입니다. 월간·주간·더보기는 미수집 데이터를 실제 최신 데이터처럼 만들지 않고 데모 범위를 안내합니다. 원본의 긴 AI 글쓰기 시연 애니메이션 일부는 정적 캡처로 유지합니다. 라이트 테마·미관찰 모달은 공통 토큰으로 근사했습니다.

원본 서버에서 404로 응답한 대시보드 가이드 이미지 5개는 대체 이미지로 꾸미지 않고 기존 공간과 대체 텍스트를 유지합니다. 이 클론은 NAEO 공식 서비스가 아닌 로컬 재현물입니다.
