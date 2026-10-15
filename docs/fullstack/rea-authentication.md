# REA 인증 근거와 구현 경계

2026-10-15 배포 로그인 청크를 REA MCP로 분석했다. 입력 SHA-256 `97558b333c51595257ee79ff833832c721286b939bb394aa80da11815a5609db`, 19,668바이트, Evidence `ev_f568454195d04e9137de94b3091bfac1f56ddc57a7b59319039e6ed951a47975`.

원문·byte 위치·해시·제한은 [근거 색인](evidence/rea-authentication-2026-10-15.json). 완전한 원본 Evidence는 작업공간 `reverse-engineering/rea-auth-2026-10-15/evidence/rea-bundle.json`에 보존한다. 색인은 원본 전체를 대체하지 않는다.

- Supabase signInWithPassword 후 session 존재 시 후속 콜백 또는 지정 경로/dashboard 이동.
- 네이버 `/api/auth/naver/login`의 next 및 선택적 reprompt=1.
- Google OAuth callback의 next와 p=google, Android 인앱 Chrome intent/iOS 안내 분기.
- mode=pg-test는 이메일 UI 상태 설정이며 서버 인증 우회 증거가 아님.
- 기존 공개 수집 청크에서 resetPasswordForEmail/verifyOtp는 SDK 정의로만 발견. 앱 호출·복구 이메일 수신의 증거는 없음.

파싱 실패/잘린 범위 0, graph coverage complete이나 semantic coverage unknown, unresolved 421개, recovered modules 0. 원본 서버·실제 로그인·이메일 정책은 미확인이다. 클론의 P1.6 Resend 및 자체 SQLite 인증은 별도 설계다.
