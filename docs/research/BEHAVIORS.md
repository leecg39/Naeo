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

## 실제 추가 관찰과 구현 연결
- 글쓰기 소분류는 원본 dropdown의 33개 value/label을 그대로 사용한다. 이미지 1/3/5장과 필수 입력, 추천 키워드 선택은 로컬 초안 생성·편집·저장으로 이어진다.
- 업데이트 23개를 전부 펼친 원본 본문을 수집했다. 초기 접힘 상태의 요약은 기존 HTML에서 복구했다.
- 홈 캐러셀은 viewport 35% 이상에서 8초 회전, hover 시 정지, 전환 220ms, swipe 60px 기준이다. 카드2/3 DOM을 추가 수집했다.
- 홈 reveal은 400ms cubic-bezier(.22,1,.36,1), rootMargin -50px; 5기준 단계선은 2.4초이다.
- 대시보드 비즈니스·경제 탭은 실제로 세 순위 모두 '-', '순위 데이터 없음'을 보여준다.
- 랭킹은 공개 200개 행을 수집했다. 분야·메이트 교집합과 점수 정렬은 이 데이터에 적용하며, 원본의 추가 페이지/미수집 기간 데이터는 별도로 구분한다.
- Ego 네이티브 pointer dispatch가 시간 초과된 경우 현재 DOM을 재확인하고 해당 원본 control의 click/mousedown으로 관찰했다.
- 로그인·결제·문자 발송·분석·글 생성 결과는 로컬 데모이며 원본 서버의 쓰기 API는 실행하지 않는다.
