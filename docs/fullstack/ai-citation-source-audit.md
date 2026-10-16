# AI 인용 수집 경로 조사

확인일: 2026-10-16. 구현 완료가 아닌 수집 근거 조사다.

## 로컬 근거

- `reverse-engineering/technical-findings.md` 42행에는 citation_count, text_citation_count, image_citation_count 등 클라이언트 지표가 있지만 인용 판정 알고리즘은 미확인으로 명시되어 있다.
- `reverse-engineering/rea-2026-10-15/README.md` 62행은 공개 요청의 `/dashboard/ai-picks`가 홈으로 리디렉션된 사실을 기록한다. 그 응답을 회원 인용 데이터의 증거로 사용할 수 없다.
- 저장된 reverse-engineering의 JavaScript 전체에서 `/api/`로 시작하고 citation/brief/ai-pick/ai_pick을 포함하는 문자열을 추출했으나 일치가 없었다. 이는 해당 이름의 정적 문자열을 찾지 못했다는 뜻이며, 다른 이름·동적 조합·미수집 청크의 API가 없다는 증거가 아니다.
- 클론의 `src/data/pages/dashboard--ai-picks.json`에는 2026-10-13 화면 캡처가 있으나 서버 수집 계약을 제공하지 않는다.
- 현재 `src/server/analysis/rules.ts`는 aiCitation.status를 not_configured로 고정하고, `ai-picks-page.ts`는 원본 계정 데이터를 지우고 미설정을 표시한다. 실제 수집 어댑터가 없다.

## 공식 공개 API 확인

[네이버 블로그 검색 API](https://developers.naver.com/docs/serviceapi/search/blog/blog.md)의 응답은 일반 검색 결과의 제목·주소·요약·블로그 정보·작성일이다. AI 브리핑에서 어떤 글을 출처로 채택했는지를 나타내는 필드는 문서에 없다. 따라서 검색 순위나 검색 결과 포함 여부를 AI 인용으로 기록할 수 없다.

[네이버 공개 API 목록](https://developers.naver.com/docs/common/openapiguide/apilist.md)에서도 이번 조사에서 AI 브리핑 인용 전용 계약을 확인하지 못했다. 비공개/제휴 API의 존재 여부까지 부정하는 판단은 아니다.

## 다음 실행 조건

원본 서비스의 로그인된 AI 인용 현황에서 조회·필터·상세 보기의 요청 경로/메서드/매개변수/응답 필드와 실제 표시 내용을 함께 확인해야 한다. 인증정보와 타 회원 개인정보는 증거에 저장하지 않는다. 화면의 읽기 요청부터 조사하며 재분석 등 비용·데이터 변경을 일으키는 행동은 구분한다.

그 뒤 원본 API가 반환하는 인용 레코드와 실제 네이버 검색의 출처를 대조하고, 클론에서 재현할 수집 수단을 결정해야 한다. 원본 서비스의 응답을 클론의 영구 백엔드로 대체 사용하지 않는다. 제공자 설정만 추가해서 끝낼 수 있는 상태가 아니며, 데이터 수집·정규화·중복 방지·회원 격리·이력·화면 연결·실제 출처 대조가 모두 남아 있다.

현재 Ego 공간15는 사용자 제어 상태로 마지막 확인되었으며 이후 재개 지시가 없어 이번 조사에서는 브라우저를 조작하지 않았다. P3.3/P3.7/P10.4를 미완료로 유지한다.
