# 공지 REA 정합성 — 2026-10-15

기존 클론의 닫기 버튼은 `naeo-announcement-dismissed:{id}:{version}=1`을 영구 저장했다. 원본의 일반 닫기와 오늘 숨김을 구분하도록 변경했다.

- 닫기: 현재 마운트된 화면에서만 닫는다. 저장소를 변경하지 않는다.
- 오늘 하루 안 보기: `announcement_dismissed`에 `{date,ids}` 저장. 날짜는 UTC ISO 날짜, 공지 ID는 중복 없이 병합한다.
- 다음 UTC 날짜의 새 마운트에서는 다시 표시한다. 한국 시각으로 오전 9시 경계다. 열린 화면을 자정에 자동으로 다시 띄우지 않는다.
- 같은 ID의 내용·버전 변경은 오늘 숨김을 해제하지 않는다.
- 손상된 JSON·저장소 접근 차단·할당량 오류에서는 공지를 영구 숨기지 않는다. 기존 영구 숨김 키는 더 이상 읽지 않는다.

근거: `../reverse-engineering/rea-deep-dive-2026-10-15/README.md` DD-03 및 Evidence `ev_a3e1798d07d5c429ee125f2d7541166da2803a056b7085875e164a441887726c`의 동일 배포 원문 해석. 배너 렌더링 추가 Evidence는 `ev_7300ba9b72c1ea93e8ce33e10b236ee5fb26f6a72a1352a7d9515d2d90ad7edb`다. 로컬 조사 폴더는 `/Users/user01/Desktop/NAEO/reverse-engineering`이다.

검증: 날짜 경계·재방문용 저장 상태·복수 ID·손상 데이터·저장 오류 테스트 2개 및 기존 공지 CRUD 테스트 3개 통과. 프로덕션 빌드 통과. 실제 브라우저 클릭·hydration 동작은 이번 검사에서 확인하지 않았다.

남은 범위: 원본 이미지 배너의 metadata(image/imageMobile/ratio/ratioMobile/display/exactPath/ctaLabel)를 현재 관리자 CRUD와 DB에 연결해야 한다. 공지 대상 landing/dashboard와 복수 공지 선정도 현재 구현과 차이가 있다. 현재 공지 UI 전체의 원본 일치를 주장하지 않는다. 전체 79 URL + 4 동적 패턴 목표는 계속 진행 중이다.
