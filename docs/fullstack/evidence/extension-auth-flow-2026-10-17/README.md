# 확장 프로그램 중복 로그인 오류 수정

## 원인과 변경

사이드 패널마다 `chrome.identity.launchWebAuthFlow()`와 PKCE 교환을 실행했다. 패널 재열기나 다른 창의 패널에서는 기존 인증 진행 상태를 알 수 없어 두 번째 요청이 `Only one web auth flow is allowed at a time.`으로 거절됐다. 수정 전 실제 패널 코드 두 인스턴스를 실행한 회귀 테스트에서 인증 API 호출 횟수가 2회로 재현됐다.

- `extension/auth.js`: 서비스 워커가 로그인 창, PKCE 검증, 코드 교환, 토큰 저장까지 한 번만 수행한다. 같은 주소의 중복 요청은 동일한 결과를 기다리며 다른 주소의 요청은 거절한다.
- 패널이 다시 열리면 진행 중인 인증을 기다린다. 로그인 중에는 버튼과 주소 입력을 잠근다. 패널이 닫혀도 워커가 토큰을 저장한다.
- 실패·취소 후 잠금을 해제한다. 기존 연결 정보는 새 인증이 성공했을 때 주소와 토큰을 함께 교체한다.
- 이전 버전이 남긴 인증 창 충돌은 한국어 안내와 **이전 로그인 창 닫기** 버튼으로 복구한다. 이 버튼은 서비스 주소·확장 ID가 일치하는 인증 페이지가 있는 단일 탭 팝업만 닫는다. 일반 창, 다른 확장의 인증, 다른 서비스 주소, 이미 외부 페이지로 이동한 창은 닫지 않는다.

## 검증

`node --test tests/extension-auth.test.mjs tests/extension.test.mjs`: **20개 통과**.

실제 서비스 워커와 패널 코드를 실행하고 Chrome API를 대체한 테스트로 다중 패널, 패널 재열기, 백그라운드 저장, 취소 후 재시도, 기존 인증 창 충돌, 주소 혼동 방지, PKCE·콜백 검증, 코드 교환 중 중복 요청, 실패 시 기존 토큰 보존, 복구 대상 제한과 메시지 발신자 검증을 확인했다.

`npx eslint extension tests/extension-auth.test.mjs`: 통과.

Ego Lite에 설치된 실제 확장에서도 확인했다.

1. 수정본을 다시 로드한 후 서비스 워커와 패널의 인증 상태 조회가 정상 동작했다.
2. 기존 인증 팝업이 남아 있어 중복 로그인 오류가 발생하는 것을 재현했다. 확장 새로고침만으로 이 팝업은 닫히지 않았다.
3. 복구 버튼으로 해당 NAEO 인증 팝업을 닫은 뒤 새 로그인이 정상 시작됐다.
4. 이후 패널에서 **저장한 글** 화면과 **저장한 글이 없습니다** 상태를 확인했다. 계정 연결과 MCP 목록 조회가 완료된 상태이며 인증 진행 상태는 `pending: false`였다.

취소·재시도와 패널 재열기 중 대기 상태는 자동 회귀 테스트로 검증했다. 실제 브라우저에서는 인증이 완료되어 연결된 계정을 유지했다.

## 적용

압축 해제 확장은 `chrome://extensions`에서 새로고침 후 패널을 다시 열어 적용한다. 검증에 사용한 Ego Lite의 설치본에는 이미 반영했다. 다른 브라우저의 설치본은 별도로 새로고침해야 한다.

## 참고

- [Chromium 인증 흐름 구현](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/api/identity/identity_launch_web_auth_flow_function.cc): 확장별 진행 중 인증 검사 및 워커 유지.
- [Chrome 서비스 워커 수명](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#chrome-116): Chrome 116 이상에서 `identity.launchWebAuthFlow()` 대기 중 워커 수명 지원. 기존 manifest의 최소 버전은 116이다.
- [Chrome 메시지 처리](https://developer.chrome.com/docs/extensions/develop/concepts/messaging): 비동기 응답을 위해 리스너에서 `true`를 반환한다.
