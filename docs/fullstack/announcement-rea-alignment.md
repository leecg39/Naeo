# 공지 REA 정합성 — 2026-10-15

기존 클론의 닫기 버튼은 `naeo-announcement-dismissed:{id}:{version}=1`을 영구 저장했다. 원본의 일반 닫기와 오늘 숨김을 구분하도록 변경했다.

- 닫기: 현재 마운트된 화면에서만 닫는다. 저장소를 변경하지 않는다.
- 오늘 하루 안 보기: `announcement_dismissed`에 `{date,ids}` 저장. 날짜는 UTC ISO 날짜, 공지 ID는 중복 없이 병합한다.
- 다음 UTC 날짜의 새 마운트에서는 다시 표시한다. 한국 시각으로 오전 9시 경계다. 열린 화면을 자정에 자동으로 다시 띄우지 않는다.
- 같은 ID의 내용·버전 변경은 오늘 숨김을 해제하지 않는다.
- 손상된 JSON·저장소 접근 차단·할당량 오류에서는 공지를 영구 숨기지 않는다. 기존 영구 숨김 키는 더 이상 읽지 않는다.

근거: `../reverse-engineering/rea-deep-dive-2026-10-15/README.md` DD-03 및 Evidence `ev_a3e1798d07d5c429ee125f2d7541166da2803a056b7085875e164a441887726c`의 동일 배포 원문 해석. 배너 렌더링 추가 Evidence는 `ev_7300ba9b72c1ea93e8ce33e10b236ee5fb26f6a72a1352a7d9515d2d90ad7edb`다. 로컬 조사 폴더는 `/Users/user01/Desktop/NAEO/reverse-engineering`이다.

검증: 날짜 경계·재방문용 저장 상태·복수 ID·손상 데이터·저장 오류 테스트 2개 및 기존 공지 CRUD 테스트 3개 통과. 프로덕션 빌드 통과. 실제 브라우저 클릭·hydration 동작은 이번 검사에서 확인하지 않았다.

추가 구현: 아래 이미지 배너 metadata CRUD를 연결했다. 추가로 아래 대시보드 대상·복수 공지 처리를 연결했다. 실제 브라우저의 표시·포커스·닫기 동작 검증은 남아 있다. 현재 공지 UI 전체의 원본 일치를 주장하지 않는다. 전체 79 URL + 4 동적 패턴 목표는 계속 진행 중이다.


## 이미지 배너 CRUD 추가

- 스키마 34: announcements.metadata JSON object. 기존 레코드는 빈 객체로 유지된다. 기존 마이그레이션 checksum은 변경하지 않았다.
- 생성·목록·수정 API에서 이미지, 모바일 이미지, 기본·모바일 비율, display, exactPath, ctaLabel을 저장·반환한다. metadata PATCH는 객체 전체 교체이며 `{}`로 초기화한다. 기존 관리자 권한·Origin·버전 충돌·감사 로그·삭제 흐름을 사용한다.
- 이미지 주소는 사이트 경로 또는 https만 허용한다. 비율은 양수 / 양수이며 0·CSS 표현식·무한대를 거절한다. exactPath는 쿼리와 fragment 없는 경로다. 이 입력 제약과 저장 구조는 클론의 자체 구현이다.
- 경로에 맞는 공지를 먼저 선별한 뒤 최신 공지를 고른다. 경로가 맞지 않는 최신 배너가 이전 적격 공지를 가리지 않는다.
- 관리자 편집기에 전체 필드를 연결했다. 이미지 배너에서 링크가 없으면 /event, CTA가 없으면 ‘이벤트 보러가기’, 기본 비율은 4 / 5다.
- 공개 화면에서 image가 있고 display가 notice가 아니면 이미지 대화상자를 사용한다. 600px 미만에서 모바일 이미지·비율을 적용하고 없으면 기본값을 쓴다. cover·중앙 정렬·60vh 제한·닫기·일일 숨김을 연결했다.
- 원본 MUI Dialog 대신 native dialog를 사용했다. showModal/닫기/Escape와 브라우저 기본 포커스 관리를 사용하지만 실제 브라우저 호환성·시각 일치 검증은 남았다.

검증: 전체 테스트 403개(root 6 + server 397) 통과 후 마이그레이션 테스트를 추가했고, 해당 파일 6개 테스트가 통과했다(현재 총 테스트 정의 404개). lint·typecheck·production build 통과. HTTP 테스트는 createApi Request/Response 핸들러를 호출하며 실제 외부 서버·브라우저 실행을 뜻하지 않는다. 근거 로그는 evidence/announcement-banner-tests.log, announcement-banner-build.log에 있다.


## 대시보드 대상과 복수 공지 — 스키마 35

REA DD-03의 배포 코드는 pathname이 /dashboard로 시작하면 dashboard, 그 외는 landing 대상 목록을 읽고 숨긴 ID에 없는 첫 공지를 선택한다. 클론의 landing을 홈 전용에서 공개 사이트 대상으로 정정하고 dashboard 대상을 추가했다. 기존 all은 공개 화면 전용 호환값으로 유지한다. 관리자·로그인·인증·결제 화면 제외는 클론의 별도 정책이다.

- DB 테이블을 재구성해 dashboard CHECK 값을 허용하고 기존 ID·metadata·version·기간·작성자·상태를 보존한다. 스키마 33과 34에서 각각 업그레이드·재오픈을 검사했다.
- 관리자 생성·수정·목록 화면에 회원 대시보드 대상을 추가했다. 대상 변경 시 조회 결과가 바로 달라진다.
- 홈·공개 페이지와 인증 후 대시보드 경로, 별도 settings/social 페이지에 공지 목록을 전달한다.
- 목록은 기간·대상·exactPath로 걸러지고 수정 시각 내림차순과 ID로 정렬된다. 이 정렬은 원본 서버를 확인한 결과가 아니라 클론의 정책이다.
- 공지를 닫으면 이번 화면의 숨김 Set에 추가하고 다음 공지를 보여준다. 오늘 숨김을 누르면 현재 Set을 UTC 날짜와 함께 저장한다. 이미 오늘 숨긴 공지는 처음부터 건너뛴다.
- 서버에서 직접 목록을 전달한다. 이후 아래 조회 API를 추가했다. 화면은 서버에서 목록을 직접 전달하는 구조를 유지한다.

검증: 전체405개(root6+server399) 통과. 이후 스키마34 배너 보존 사례를 보강한 공지 테스트7개 재통과. lint 및 production build 통과. UI 순차 클릭·Escape·포커스·반응형은 실제 브라우저 미검증 상태다. 서버 테스트 통과를 이 영역의 완료 근거로 사용하지 않는다.


## 공지 조회 API — 스키마 36

`GET /api/announcements?target=landing|dashboard`를 추가했다. REA HTTP-05의 저장된 원문(`reverse-engineering/rea-deep-dive-2026-10-15/evidence/announcements-landing.body`)에서 확인한 `announcements` 배열과 `id/title/content/type/target/link_url/metadata/start_date/end_date` 필드를 반환한다. 내부 작성자·수정자·status·version은 공개 응답에서 제외한다. 관리 API는 기존 필드를 유지한다.

- 스키마36에 type(coupon/feature/maintenance/event/blog)을 저장하며 관리자 생성·수정 폼에서 선택한다. 다섯 값은 REA DD-03과 같은 배포 원문의 타입별 렌더링 분기에서 확인했다. 기존 텍스트 공지의 기본 maintenance는 클론의 마이그레이션 정책이다.
- 원본 서버에서 확인하지 못한 정책: target 생략 시 landing, 잘못된 target은400, dashboard는 로그인+약관 동의 필요, GET 외에는405, 빈 링크/기간은null, 날짜는 UTC ISO, all은 landing으로 매핑한다. 이 동작을 원본 전체 규약 복원으로 표현하지 않는다.
- 기간·상태·대상 선별은 화면과 같은 서비스 함수를 사용한다. API는 exactPath를 제거하지 않고 metadata로 반환하고, 현재 화면은 해당 경로에 맞게 별도 선별한다.
- 생성·수정·유형/대상 변경·삭제가 조회 API에 즉시 반영된다. no-store 응답이다.

실제 실행: `node --import tsx scripts/qa/announcements.ts`가 임시 DB와 production Next 서버를 만들고 관리자 로그인, 생성, 공개 조회, 이벤트 SSR 속성 포함, 대상/유형 수정, 무인증 dashboard401·인증 조회, 삭제를 HTTP 요청으로 검증했다. 프로세스와 임시 데이터는 종료·제거됐다. evidence/announcements-runtime.json 참조. SSR에 속성이 포함된 것은 이미지 표시·클릭·focus 검증이 아니다.

전체406개(root6+server400) 테스트, lint·typecheck·production build 통과. 기존 DB33/34 업그레이드 테스트도 새36까지 실행된다.

새로 명시한 잔여 차이: 원본 landing 응답은 metadata.display=ticker를 사용한다. 이후 아래 ticker 구현을 추가했다. 또한 coupon/feature/maintenance/blog의 원본 유형별 전용 화면은 아직 일반 공지 렌더러로 처리한다. 이미지 배너 외 유형별 UI와 실제 브라우저 시나리오는 계속 구현·검증해야 한다.


## 흐르는 공지 띠(ticker)

REA에 입력한 동일 배포 청크의 `j` 함수에서 조건·스타일·아이콘 치환을 확인했다. 정확한 원문 SHA-256과 UTF-8 byte 범위는 evidence/ticker-source.json에 보존했다. 별도의 새 REA 실행이나 브라우저 관찰을 했다는 뜻은 아니다.

- 관리자 표시 방식에 ticker를 추가하고 기존 metadata JSON·버전·CRUD·조회 API에 연결했다. 이미지 없이 설정 가능하며 링크 문구를 강제하지 않는다.
- 내용 우선, 비어 있으면 제목. [coffee]/[airpods]/[ipad]를 원본 아이콘으로 표시한다. 알려지지 않은 토큰은 텍스트로 남는다.
- body header 높이를 측정해 그 아래 고정한다. 150/600/1500/3000ms와 resize에서 재측정하며 높이가 없으면 숨긴다. 첫 측정은 React effect 안의 requestAnimationFrame으로 수행한다.
- exactPath 불일치·/event/ 상세 경로·빈 내용에서 숨긴다. 링크 기본값은 /event다.
- 문장을 3회 반복하고 `max(14, round(0.28 * 문자열 길이))`초 동안 1/3만큼 이동한다. 마우스 hover·키보드 focus 동안 정지한다. prefers-reduced-motion은 애니메이션과 중복 문장을 숨긴다.
- 데스크톱52px/모바일48px, 원본 초록색과 그라데이션·아이콘 크기를 반영했다. 닫기는 일일 숨김 콜백에 연결한다.
- 원본의 anchor 내부 button 대신 region 내부에 링크와 닫기 버튼을 형제로 두어 중첩 인터랙티브 요소를 피했다. 이것은 클론의 마크업 선택이다.
- 원본 WebP3개를 다운로드해 public/event/review-2026-09에 보존했다. URL·크기·해시는 evidence/ticker-assets.json에 있다.

검증: 전체407개(root6+server401), lint/typecheck/build 통과. production Next HTTP QA에서 ticker metadata 수정·조회와 WebP3개 HTTP200 및 파일 시그니처를 검사했다(evidence/ticker-runtime.json). 임시 서버·DB는 정리했다.

브라우저 상태 재확인: Ego에는 사용자 소유 IRON RIFT 공간10만 있고 기존 NAEO 공간은 없다. ego-browser 스킬의 새 복구 TaskSpace 금지 규칙에 따라 새 공간을 만들지 않았다. 실제 위치·애니메이션·hover/focus 정지·모바일·모션 감소·닫기 클릭은 미검증이다. coupon/feature/maintenance/blog 전용 UI도 여전히 남았다. 전체 목표는 미완료다.
