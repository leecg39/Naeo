# MP4·홈 복원 검증 자료

2026-10-16, 격리한 Next 프로덕션 서버와 실제 FFmpeg·Ego Lite에서 확인했다. [구현 설명](../../mp4-home-implementation-2026-10-16.md)과 [요약 JSON](summary.json)을 함께 본다. QA 회원 비밀번호·쿠키·DB는 포함하지 않았다.

## 실행 결과

- [전체 테스트 로그](tests.log): 루트 12 + 서버 478 = **490개 통과**, 실패·건너뜀 0.
- [프로덕션 빌드 로그](build.log): 컴파일·TypeScript·정적 페이지 생성 통과.
- lint·typecheck 통과. `git diff --check` 통과.
- 원본 관찰은 읽기 전용. 검증 후 Ego TaskSpace 6, 임시 worker·서버를 종료했다.

## MP4

- [실제 브라우저 다운로드 파일](naeo-mp4-sample.mp4): 43,138바이트. SHA-256 `41f8aedf81747e1bcc51934f028d18aad7f280b14d4d1f022bd38edbcfa52466`.
- [ffprobe 결과](mp4-ffprobe.json): H.264/yuv420p, 1920×1080, 30fps, 2초, 오디오 스트림 없음.
- [디코딩한 첫 프레임](mp4-frame.png): 한글·배경색 확인.
- [대기 화면](mp4-queued.png), [390px 내보내기](mp4-mobile.png).
- [생성·새로고침·다운로드 결과](mp4-browser-result.json), [대기 작업 취소 결과](mp4-cancel.json).

MP4 자동 테스트는 실제 파일의 장면 색상 순서·세 가지 프로젝트 크기와 작업 복구·권한·제한·삭제 경합을 별도로 검증한다. 브라우저 샘플은 2장×1초의 한 사례다.

## 홈

- [1440px 완성 글](home-demo-desktop.png), [390px 휴대폰 미리보기](home-demo-mobile.png): 직접 열어 화면 확인.
- [데스크톱 측정](home-desktop.json): 12개 섹션, 로딩 스피너 없음, 실제 0명 랭킹 상태, 한 패널 표시, 가로 넘침 없음.
- [모바일 측정](home-mobile.json): viewport/scrollWidth 모두 390, 휴대폰 내부 스크롤 0→574px.
- [제어 결과](home-controls.json): ChatGPT·Claude 제목/도구 행 변경, 동작 줄이기 초기 4단계·중지, 자동 재생 0→1.
- [원본 예시 관찰](source-demo-settled.png), [관찰 전 DOM](source-demo-before.json), [관찰 후 DOM](source-demo-after.json).

원본 예시는 비교용 관찰이다. 클론의 5단계 복원과 원본의 모든 세부 애니메이션이 같다는 근거로 사용하지 않는다. 랭킹의 공개 동의 필터와 데이터가 있는 경우는 자동 테스트에서 확인했고, 브라우저 QA DB는 0명 빈 상태였다.
