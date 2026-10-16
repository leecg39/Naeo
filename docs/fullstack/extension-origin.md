# 확장 프로그램 Origin과 MCP 호출

2026-10-16

## 확인한 장애

서버는 `/auth/extension`에서 확장 클라이언트를 등록하고 회원 동의·PKCE 코드 교환을 지원하지만, `/api/mcp`는 사이트와 다른 모든 Origin을 403으로 차단했다. 따라서 확장 Origin을 포함한 요청은 유효한 확장 토큰으로도 사용할 수 없었다.

격리 DB와 실제 API 핸들러로 회원 생성 → 확장 클라이언트 → 회원 동의 → PKCE 토큰 교환 → `chrome-extension://{id}` Origin의 MCP ping을 실행했다. 수정 전 ping이 403으로 실패하는 회귀 테스트를 확인했다. 브라우저 네트워크 트래픽을 캡처한 결과는 아니다.

## 수정 경계

- 정확히 `chrome-extension://`와 a–p 문자 32자리로 구성된 Origin만 확장 후보로 취급한다.
- ID가 현재 `NAEO_EXTENSION_IDS`에 포함되어야 한다.
- Bearer 인증을 통과하고 토큰의 clientId도 해당 `naeo-extension-{id}`와 같아야 한다.
- 기존 토큰 만료·철회·resource·scope 검사를 유지한다.
- 일반 웹사이트 Origin, null Origin, 유사 호스트, 경로가 붙은 값, 다른 확장 토큰, 일반 MCP 클라이언트 토큰으로는 확장 Origin 요청을 허용하지 않는다.
- 허용 목록은 매 요청 읽는다. 허용 목록 제거는 해당 Origin의 호출을 차단하며 토큰 자체를 철회하는 기능은 아니다. 완전한 앱 철회는 기존 연결된 앱 해제를 사용한다.

이 변경은 확장 서비스 워커/확장 페이지가 host_permissions를 갖고 직접 서버를 호출하는 연결 방식에 해당한다. 콘텐츠 스크립트는 웹페이지 Origin 제약을 받으므로 이 허용 목록으로 네이버 등 웹사이트 Origin을 열지 않는다. [Chrome 공식 네트워크 문서](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)를 확인했다.

## 검증과 남은 범위

`tests/server/mcp.test.ts`의 확장 전용 회귀 테스트는 정상 호출, 허용된 다른 확장과의 토큰 불일치, 미등록/변조 Origin, 일반 MCP 토큰, 잘못된 토큰, 읽기 전용 scope의 쓰기 거부, 허용 목록 제거를 검증한다.

실제 확장 코드·설치 ID·host_permissions·브라우저 로그인/호출/철회·네이버 편집기 발행 흐름은 아직 검증하지 않았다. 이 수정으로 P7.6이나 전체 목표를 완료 처리하지 않는다. 원본 확장의 내부 프로토콜을 복원했다는 의미도 아니다.

검증 결과: `npm test` 전체 420개(기본 6 + 서버 414), `npm run typecheck`, `npm run lint`, `git diff --check` 통과. [전체 테스트 기록](evidence/extension-origin-tests.txt).
