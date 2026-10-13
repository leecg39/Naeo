# 동작 관찰 기록

- 원본 배포 CSS와 브라우저 computed style을 동시에 보존한다. 각 route의 runtime-*-1440.json에 computed, DOM, CSSOM, images, videos가 있다.
- 공통 헤더: fixed, backdrop blur16px, z-index100. 태블릿 900px 미만 메뉴 숨김, 모바일 메뉴 버튼. 390px MCP에서 문서 폭390px, 버튼폭40px.
- 요금제/FAQ: 클릭 아코디언, aria-expanded false→true. MUI collapse 250ms.
- MCP: NAEO가 다 써주기 / 내 AI로 직접 쓰기 클릭 전환. 뒤의 가이드는 Claude/ChatGPT 전환. 영상 자체를 로컬 다운로드해 유지.
- 랭킹: 전체/월간/주간 클릭 전환. 분야·메이트 필터. 실제 UI 데이터 및 백엔드는 로컬 fixture로 대체.
- 대시보드: 고정 240px sidebar, 오른쪽 margin-left240px main; tab 기간 선택, 캡처 모달, 로컬 스캔 상태, 검색·필터.
- 로컬 복제본은 원본 로그인·글 생성·유료 결제·문의전송을 실행하지 않는다. 의미 있는 상태 전환과 저장은 localStorage 사용.
- 이전 조사에서 검정 스크린샷 문제가 있었으나 이번 1440px 요금제 캡처는 정상 확인했다.
- 추가 페이지별 상태·모바일·hover 결과는 구현/검증 시 계속 보강한다.
