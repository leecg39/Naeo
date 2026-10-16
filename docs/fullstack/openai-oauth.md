# 회원별 OpenAI OAuth 연결

2026-10-16 현재 로컬 구현과 모의 공급자 검증은 완료했다. 사용자는 API 키가 아니라 회원이 각자 ChatGPT 계정을 연결하는 배포 서비스를 선택했다. Codex 인증 파일이나 운영자 개인 토큰은 사용하지 않는다. 실제 OpenAI 왕복은 NAEO 배포 서비스용 승인 클라이언트가 발급되고 콜백이 등록된 뒤에만 검증할 수 있다.

## 구현 범위

- `/dashboard/settings`에서 연결 상태·계정 메타데이터를 조회하고 연결 시작·해제를 수행한다. 토큰 원문은 화면·API·감사 로그·개인정보 내보내기에 포함하지 않는다.
- `/api/account/openai/start`는 로그인·Origin·요청 제한을 확인한 뒤 state 해시, PKCE verifier/challenge, nonce, 브라우저 바인딩 쿠키를 만든다. 설정이 없으면 DB에 state를 남기지 않고 503을 돌려준다.
- `/api/account/openai/callback`은 일회 state, 동일 로그인 회원, 브라우저 바인딩, 만료, issuer, audience/azp, RS256 서명, nonce, 필수 범위 `openid profile email offline_access chatgpt.tokens.use.direct`를 확인한다.
- access·refresh·ID 토큰은 AES-256-GCM으로 암호화하고 연결·토큰 버전을 AAD에 묶는다. 회원당 연결 하나, OpenAI subject는 전체 회원에서 하나만 허용한다.
- 갱신은 DB lease로 직렬화하고 회전된 refresh token을 원자적으로 교체한다. `invalid_grant` 같은 최종 오류는 연결을 제거해 재인증을 요구하고, 일시 오류는 작업 재시도 시각을 보존한다.
- 글 생성은 작업 소유자와 연결 revision을 함께 저장한다. 실행 시 같은 회원·같은 revision의 자격 증명만 사용한다. 연결을 해제한 뒤 대기 중인 작업은 다른 회원 또는 Anthropic 자격 증명으로 대체 실행하지 않고 실패·환급한다.
- 계정 모델은 같은 bearer로 `GET /v1/models`에서 조회하고 `visibility=list`인 slug를 선택한다. `POST /v1/responses`는 `store:false`, `stream:true`로 호출하며 `response.completed` 이전의 델타를 성공으로 처리하지 않는다.
- OpenAI 연결이 없고 `ANTHROPIC_API_KEY`가 있으면 기존 Anthropic 경로를 사용한다. 승인 OpenAI 클라이언트는 설정됐지만 회원 연결이 없으면 연결을 요구한다.

## API와 데이터

| 항목 | 계약 |
|---|---|
| `GET /api/account/openai` | 로그인 회원의 안전한 연결 상태. 토큰·subject·내부 ID 미노출 |
| `GET /api/account/openai/start` | OAuth 승인 주소로 302. 설정 미완료는 503 `OPENAI_NOT_CONFIGURED` |
| `GET /api/account/openai/callback` | OpenAI 콜백. 성공·오류를 안전한 설정 화면 주소로 302 |
| `DELETE /api/account/openai` | 원격 refresh token 철회를 시도한 뒤 로컬 연결은 항상 삭제 |
| `openai_connections` | 회원·issuer·subject, 암호화 토큰, 만료·최초 갱신 시각, revision/token_version, refresh lease |
| `openai_connection_states` | state 해시, 회원, 바인딩 해시, PKCE verifier, nonce, 복귀 주소, 만료 |
| `generation_jobs.credential_revision` | 큐 등록 시 연결 버전 고정 |

필수 환경 변수는 `.env.example`에 있다. `NAEO_OPENAI_CLIENT_ID`는 발급된 `oaiapp_…` 값만 받고, `NAEO_OPENAI_TOKEN_ENCRYPTION_KEY`는 64자리 hex다. `NAEO_APP_URL`과 정확히 일치하는 `/api/account/openai/callback`을 공급자에 등록해야 한다. client secret이 있는 confidential client와 없는 public client를 모두 처리한다. OAuth/API base override는 loopback 로컬 모의 검증에서만 허용한다.

## 확인한 근거

- 전용 8개 테스트에서 미설정 무저장, PKCE·nonce·일회 state·브라우저 바인딩, 잘못된 서명·범위·계정 충돌, 토큰 암호화·철회, 회전 갱신과 최종 오류, 모델·Responses 완료 이벤트, 두 회원 격리, 연결 해제 후 실패·환급, HTTP Origin·세션을 확인했다.
- 전체 427개 테스트, lint, typecheck, production build가 통과했다.
- Ego Lite에서 임시 회원으로 설정·글쓰기 화면을 확인했다. 설정 전 연결 버튼은 실제 disabled이고 `승인 클라이언트 미설정`을 표시하며, 390px에서 가로 넘침이 없다. 실행 중 서버가 스키마 37을 계속 쓰면서 설정 화면이 500이 되는 문제를 발견했고 서버 재시작 후 스키마 39와 정상 렌더를 확인했다. 임시 회원은 영구 삭제했다.
- 증거: [검증 로그](evidence/openai-oauth-2026-10-16/verification.txt), [모바일 설정 화면](evidence/openai-oauth-2026-10-16/openai-settings-mobile.png).

## 남은 외부 조건

NAEO 배포 서비스용 OpenAI client ID 승인, 실제 HTTPS 서비스 도메인과 콜백 등록, 허용된 ChatGPT plan usage 범위가 필요하다. 승인 후 실제 회원 두 명으로 동의→모델 조회→글 생성→초안 저장, 만료 갱신, 연결 해제, 사용량 초과, 중단·중복 요청을 검증한다. 현재 로컬 모의 공급자 결과를 실제 OpenAI 성공으로 확대하지 않는다.

OpenAI의 이 OAuth 경로는 AI 이미지 생성을 제공하지 않는다. 이미지 생성, 네이버 AI 브리핑 인용 근거 수집, 실제 외부 공급자 왕복은 별도 미완료 항목이다.

공식 계약 확인: [토큰 수명주기](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [모델과 추론](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [토큰 참조](https://developers.openai.com/siwc/token-sharing-open-source/token-reference), [오류와 복구](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery), [배포 서비스 로그인](https://developers.openai.com/siwc/website), [클라이언트 신청](https://developers.openai.com/siwc/request-client-id).
