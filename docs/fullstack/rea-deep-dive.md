# NAEO REA 추가 분석 — 2026-10-15

사용자의 “REA로 역공학” 요청에 따라 공개 배포 JavaScript 4개를 **REA CLI 6.1.0**으로 추가 분석했다. 입력 합계 143,174바이트, 파싱 실패 0이다. 별도 공개 HTTP 관찰 6개로 MCP 인증 안내, 공지와 업데이트 본문 응답을 확인했다. 제품 코드는 변경하지 않았다.

검증된 해시·원문 byte 범위·완전한 REA 기록의 식별자·HTTP 요청 정보는 [근거 색인](evidence/rea-deep-dive-2026-10-15.json)에 있다. 이 JSON은 조사자가 만든 요약이며 REA 원본을 대체하지 않는다. 대용량 원본 100,228,978바이트는 로컬 `/Users/user01/Desktop/NAEO/reverse-engineering/rea-deep-dive-2026-10-15/evidence/`에 보존했다. 색인의 `source_path`와 `body_path`는 해당 결과물 폴더 기준이다.

## 확인한 계약

| 영역 | 확인 내용 | 근거 |
|---|---|---|
| 문의 | POST `/api/inquiry`: type/email/subject?/message. 이메일 비어 있음·본문 trim length < 5를 클라이언트에서 거절. 429 별도 처리 | DD-01/02, 문의 REA |
| 공지 | target은 dashboard 또는 landing. localStorage `announcement_dismissed`에 date/ids 저장. 날짜는 UTC ISO 날짜. 공개 landing 응답 200과 announcements 배열 확인 | DD-03, HTTP-05 |
| 업데이트 | GET `/api/updates/content/{slug}` → serialized. 열린 항목이며 초기 값이 없을 때 요청, staleTime Infinity·retry 1. 기존 공개 slug 1개에서 compiledSource/frontmatter/scope 확인 | DD-04/05, HTTP-06 |
| MCP 주소 | 배포 상수 `https://www.naeo.kr/api/mcp`. GET은 405·Allow POST, 토큰 없는 POST initialize는 401 | DD-06, HTTP-01/02 |
| OAuth 발견 | 401의 resource_metadata 링크와 인증 서버 메타데이터 모두 200 | HTTP-03/04 |

공지의 날짜가 UTC이므로 한국 날짜와 오전 9시 이전에 차이가 날 수 있다는 것은 코드에서 도출한 해석이다. 열린 페이지의 자동 날짜 갱신이나 계정별 서버 동기화를 확인한 것은 아니다. 업데이트의 compiledSource 렌더러는 정적 코드만 읽었고 다운로드한 JS/MDX를 실행하지 않았다.

## MCP 서버가 선언한 설정

공개 메타데이터: [보호 리소스](https://www.naeo.kr/.well-known/oauth-protected-resource), [인증 서버](https://www.naeo.kr/.well-known/oauth-authorization-server).

- resource: `https://www.naeo.kr/api/mcp`
- authorization_endpoint: `https://www.naeo.kr/api/oauth/authorize`
- token_endpoint: `https://www.naeo.kr/api/oauth/token`
- registration_endpoint: `https://www.naeo.kr/api/oauth/register`
- response type: `code`
- grant types: `authorization_code`, `refresh_token`
- PKCE method: `S256`
- token endpoint client authentication method: `none`
- scope: `mcp`; bearer method: `header`

이는 공개 선언이다. `none`을 사용자 인증 불필요로 해석하지 않는다. authorize/token/register 실행, OAuth 동의, 인증된 MCP tools/list·tools/call은 수행하지 않았다. 실제 PKCE 강제, 토큰 회전·철회, 도구 스키마·계정 연결 성공은 미확인이다.

## REA 식별자

| 영역 | Evidence ID |
|---|---|
| 문의 | `ev_7ab3410c11dd7a74cbc92d6df9ec48e763856a4066dfaa3fd587f65e22a1122b` |
| 공지 | `ev_a3e1798d07d5c429ee125f2d7541166da2803a056b7085875e164a441887726c` |
| 업데이트 | `ev_ba046adfb5d6261508cfdba882b08701475f5b9cb711688aa7161d1b39c8b575` |
| MCP | `ev_fabed7eabae82b5bc72b6bc2c0fc976f0bafb92ddfe8fc725875e5863e153f59` |

모두 graph coverage complete이지만 semantic coverage unknown, 미해결 관계 총 2,135개, recovered modules 0이다. REA의 `.get()` endpoint 후보 중 HTTP 경로가 아닌 값과 동적 template URL 누락을 색인에 표시했다. 발견 DD-*는 원문을 직접 읽어 보완한 조사자 해석이며, HTTP-*는 REA 런타임 Evidence가 아닌 직접 요청 기록이다.

## 검증과 남은 범위

입력 4개의 SHA-256, REA 관찰의 원본 해시, 발견 6개의 UTF-8 byte 범위, HTTP 응답 6개의 본문 해시를 검증했다. 문서와 증거만 추가했으므로 제품 테스트·빌드를 재실행하지 않았다. 이전 제품 검증 결과를 이번 분석의 실행 근거로 재사용하지 않는다.

79개 구체 URL과 4개 동적 패턴은 경로 인벤토리다. 전체 기능을 실행했다는 수치가 아니다. Ego의 기존 NAEO 공간이 없어 새 인증 브라우저 관찰은 없었다. 기존 새 공간 생성 질문의 답변을 기다리며 다른 작업 공간은 사용하지 않았다.

인증 대시보드, 글 생성·저장·발행, MCP 도구 스키마, 실제 보상 정책, 관리자·공유 화면, 원본 AI/DB 내부는 여전히 미확인이다. 기존 풀스택 목표와 TASKS의 미완료 항목은 유지한다.
