# OpenAI OAuth 적용 범위와 남은 구현

2026-10-15 확인. 사용자는 API 키 생성 대신 OpenAI OAuth를 선택했다. 키 선택 질문은 답변 완료이며, 새 API 키를 만들거나 기존 Codex 인증 파일을 재사용하지 않는다.

## 확인된 범위

- [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source): 로컬·오픈소스 앱의 이용 경로와 유료·원격 호스팅 앱의 신청 경로가 다르다. NAEO의 실제 사용 형태 확인이 필요하다.
- [등록 및 로그인](https://developers.openai.com/siwc/token-sharing-open-source/sign-in): 로컬 앱은 동적 등록, 호스트 식별자, loopback 콜백, state/nonce/PKCE와 ID 토큰 검증을 사용한다. 사용자 동의를 거친 앱 전용 등록이 필요하다.
- [추론](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference): 계정별 모델 목록과 Responses 스트림을 사용한다. 완료 이벤트 전의 일부 텍스트를 성공으로 처리하면 안 된다.
- [지원 제한](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations): OAuth 사용 경로의 이미지 생성은 지원되지 않는다. 웹 검색은 계정·모델 정책에 따르며 NAEO가 요구하는 네이버 AI 브리핑 인용 근거를 자동으로 증명하지 않는다.
- [상용 클라이언트 신청](https://developers.openai.com/siwc/request-client-id): 별도 신청이 필요하다. 신청 또는 승인됐다는 근거는 현재 없다.

## 코드와 차이

현재 `src/server/generation/provider.ts`는 Anthropic Messages 공급자다. `generation.ts`의 설정 검사와 worker는 기존 공급자 경로를 사용한다. OAuth 로그인·토큰 저장·갱신·OpenAI 스트림 공급자는 아직 구현되지 않았다. 사용자 답변만으로 연결됐다고 표시하지 않는다.

OAuth의 개인별 사용량을 기존 운영자 공용 API 키 설정에 끼워 넣으면 회원 간 인증 주체가 섞인다. 실제 사용 형태를 정한 뒤 작업 소유자와 인증 계정을 명시적으로 연결해야 한다. 현재 이미지 미설정 오류와 차감 전 거절은 유지한다.

## 실행 항목

1. 로컬 개인 사용 또는 회원별 배포 서비스 확인. 로컬이면 앱 전용 동적 등록으로 진행하고, 배포 서비스면 해당 유형에 승인된 클라이언트와 콜백 조건을 확보한다. 기존 Codex 로그인 토큰을 웹서비스 공용 자격 증명으로 복사하지 않는다.
2. 인증 수명주기 구현: 등록/연결/상태 조회/연결 해제, 회원과 계정의 소유권, 일회용 state·nonce·PKCE, 서명/issuer/audience/만료 검증, 토큰 보호 저장 및 갱신 경합 처리. 거절·로그아웃·계정 불일치가 기존 연결을 덮어쓰지 않는지 검증한다.
3. 글 생성 연결: 해당 계정의 모델 조회, 토큰 갱신 후 Responses 스트림, 요청 시간·출력 크기 제한, 완료 이벤트 필수, 실패/중단/재시도와 기존 차감·환급 원장 통합. 서로 다른 두 회원의 작업이 같은 자격 증명을 사용하지 않는지 확인한다.
4. 실제 검증: 사용자 동의부터 글 저장까지 왕복, 만료/갱신/연결 해제/사용량 초과/중단/중복 요청, 두 회원 격리, UI 오류와 모바일. 스텁 테스트와 실제 공급자 검증은 별도 증거로 기록한다.

AI 이미지는 여전히 P4.2 미완료다. OAuth 텍스트 연결을 마쳐도 이미지·네이버 인용 근거·나머지 외부 공급자·최근 UI 브라우저 검증을 완료한 것으로 처리하지 않는다.
