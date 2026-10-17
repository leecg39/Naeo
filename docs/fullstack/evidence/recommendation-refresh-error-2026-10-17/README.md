# 추천 생성 오류 수정 — 2026-10-17

## 재현과 원인

사용자가 신고한 `/dashboard/recommendations`에서 선택된 블로그는 `qa-admin-blog`였다. 운영 DB를 읽기 전용으로 확인한 결과 수집 글과 추천이 없고, 최근 추천 생성 실패 기록은 `네이버에서 블로그를 찾을 수 없거나 공개 글이 없습니다.`였다. 실제 RSS 요청도 `CollectError(BLOG_NOT_FOUND, retryable=false)`로 실패했다.

추천 서비스가 `CollectError`를 인식하지 못해 복구 불가능한 소스 오류까지 HTTP 502와 “잠시 후 다시 시도해주세요”로 변환했다. 제목만 있고 글이 없는 RSS는 HTTP 200 안내로 반환했으나, 화면의 후속 목록 조회가 그 안내를 덮어쓰는 문제도 있었다.

## 수정

- 블로그 없음·잘못된 ID·공개 글 없음은 HTTP 422 `RECOMMENDATION_BLOG_UNAVAILABLE`로 반환하고 블로그 ID 및 글·RSS 공개 설정 확인을 안내한다.
- 일시적인 RSS 장애는 HTTP 503 `RECOMMENDATION_RSS_UNAVAILABLE`과 `retryable=true`로 구분한다.
- 오류 안내에서 `/dashboard/settings#blogs`의 “내 블로그” 관리 영역으로 이동할 수 있다.
- 실패 기록과 생성 잠금 해제를 유지하며, 실패한 생성은 월 추천 한도에 포함하지 않는다.

실제 사용자 블로그 ID나 공개 설정을 임의로 변경하지 않았다. 현재 데이터로 추천 생성이 성공했다는 의미는 아니며, 정상적인 공개 RSS를 가진 실제 블로그 ID가 필요하다.

## 검증

- 변경 전 신규 회귀 테스트 4개 모두 실패: [tests-before.txt](tests-before.txt).
- 수정 후 RSS 수집·추천 서비스·HTTP·페이지 관련 테스트 **29개 통과**: [tests.txt](tests.txt).
- 404 RSS, 글 없는 RSS, 오류 HTML, 일시적 503, 실패 후 정상 RSS 재시도, 한도 미차감 및 생성 잠금 해제를 확인했다. 정상 재시도는 격리된 테스트 DB와 주입한 RSS 응답을 사용했다.
- 타입 검사 및 변경 파일 ESLint 종료 코드 0: [typecheck.txt](typecheck.txt), [lint.txt](lint.txt).
- Ego Lite의 실제 로그인 화면에서 “블로그에서 추천 찾기”를 클릭해 아래 문구와 설정 링크를 확인했다: [1428×747 화면](error-desktop.png).

> ‘qa-admin-blog’에서 공개 글을 가져올 수 없습니다. 블로그 ID와 글·RSS 공개 설정을 확인해주세요.

- 설정 링크를 실제 클릭한 뒤 `/dashboard/settings#blogs`, “내 블로그” 제목 및 해당 블로그 수정 버튼의 화면 내 표시를 확인했다. 사용자 데이터 변경 없이 검증용 브라우저 작업을 종료했다.
