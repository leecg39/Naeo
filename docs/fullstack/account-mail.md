# 이메일 인증·비밀번호 복구

2026-10-15 · 스키마 30 · P1.6 구현 진행. 전체 목표는 active.

로그인 화면에서 재설정 안내를 요청하고 `/auth/reset-password`에서 새 비밀번호를 확정한다. 계정 설정에서 인증 메일을 명시적으로 요청하고 `/auth/verify-email`에서 확인 버튼을 누른다. 가입 직후 자동 발송이나 이메일 미인증 계정 로그인 차단은 추가하지 않았다.

## 원본과 구현의 구분

REA 로그인 청크 분석은 Supabase 이메일 로그인, 네이버 로그인 URL, Google 인앱 분기를 확인했다. 공통 SDK에 복구·OTP 함수가 있다는 사실만으로 원본 서비스가 그 기능을 호출한다고 볼 수 없다. 이번 Resend·SQLite 메일 큐는 계획 P1.6을 충족하기 위한 자체 설계다. 원본 서버나 원본 메일 공급자의 복원으로 표현하지 않는다.

원본 근거: `reverse-engineering/rea-auth-2026-10-15` (작업공간 루트). 저장소용 요약은 `rea-authentication.md`.

## API와 저장 모델

| API | 권한·동작 |
|---|---|
| POST `/api/auth/password/forgot` | 이메일 입력, 알려진/없는/정지 계정 모두 동일한 202 안내. 설정 없으면 503 |
| POST `/api/auth/password/reset` | 일회용 토큰·새 비밀번호. 비밀번호 변경, 이메일 확인, 전체 세션·OAuth 권한 철회 |
| POST `/api/auth/email/verify` | 일회용 토큰, 이메일 확인 및 해당 사용자 인증 링크 전체 무효화 |
| GET `/api/auth/email/status` | 로그인한 본인의 인증 여부와 안전한 발송 상태 |
| POST `/api/auth/email/request` | 로그인한 본인의 인증 메일 요청, 엄격한 빈 JSON 입력 |

`account_mail`에는 소유자, 용도, SHA-256 토큰 해시, 암호화 본문, 상태, lease, 재시도 시각, 만료 시각을 저장한다. 토큰은 32바이트 난수이며 재설정 30분·이메일 인증 60분 유효하다. AES-256-GCM으로 본문을 암호화하고 메시지 ID를 AAD로 사용한다. 공급자 접수 성공 또는 최종 실패 시 암호화 본문을 제거한다. TTL 이후 행은 정리한다.

이메일 링크의 토큰은 fragment에 있다. 화면은 이를 메모리로 읽고 주소에서 제거하며 GET만으로 인증·재설정을 실행하지 않는다. 명시적인 POST 때 용도·소유 계정·만료·일회성을 검사한다. 비밀번호 해싱 전후에 링크를 검사하고 트랜잭션으로 한 번만 소비한다. 비밀번호·이메일·계정 상태·역할이 바뀌면 기존 링크를 DB trigger로 무효화한다. 계정 삭제는 FK cascade로 제거한다.

요청은 기존 Origin 방어, peer당 15분 30회, 재설정 주소당 시간당 5회, 인증 요청 사용자당 시간당 5회 제한을 적용한다. 사용자·용도당 60초 큐 중복 방지도 적용한다. 일반 응답은 계정 존재를 직접 노출하지 않지만 네트워크 시간 기반 부채널까지 검증한 것은 아니다.

## 공급자·작업자

[Resend 이메일 API](https://resend.com/docs/api-reference/emails/send-email)와 [멱등 요청 계약](https://resend.com/docs/dashboard/emails/idempotency-keys)을 사용한다. 동일 메시지 ID와 본문으로 재시도하며 공급자 접수는 받은편지함 도착과 구분한다. 요청 타임아웃은 10초, lease는 60초, 최대 5회 시도다. 429·5xx·통신 실패·동시 처리 409는 만료 전 재시도하며 영구 오류는 종료한다. 결과 저장은 lease token으로 보호한다. 발신자·서비스 origin이 바뀐 큐 항목은 전송하지 않는다.

`NAEO_EMAIL_PROVIDER=resend`, `NAEO_RESEND_API_KEY`, `NAEO_MAIL_FROM`, 64자리 hex `NAEO_MAIL_ENCRYPTION_KEY`, `NAEO_APP_URL`이 필요하다. 공개 운영 주소는 HTTPS여야 한다. 테스트 endpoint override는 HTTP loopback만 허용한다. 설정이 없으면 UI는 이용 불가를 표시하고 요청 API는 503을 반환한다. 계정 메일만 연결했으며 문의 답변·마케팅·스캔 알림 발송은 포함하지 않는다.

## 검증 근거

- 전용 테스트 18개, 전체 테스트 375개(기반 6 + 서버 369), lint/typecheck/build 통과.
- 최초 모듈 부재, 비밀번호 폼 7곳의 기본 GET 제출 위험, 서비스 origin 변경 후 이전 링크 발송을 RED로 확인했다. 폼을 POST로 수정하고 origin 변경 검사를 추가했다.
- 실제 프로덕션 Next/worker + loopback HTTP 메일 서버: 인증 요청/확인, GET 비소비, 한 번만 사용, 기존/없는 계정 동일 안내, 비밀번호 변경, 기존 세션·암호 거절 및 새 암호 로그인 성공.
- 로컬 공급자가 접수 뒤 503을 반환하는 상황에서 같은 본문·멱등 키로 재시도. 요청 3회, 로컬 중복 제거 후 메시지 2개.
- 개인정보 내보내기는 스키마 30의 안전한 메일 메타데이터를 포함해 42개 데이터셋. 실제 토큰·해시·암호화 본문 제외를 검사하고 실제 TAR·첨부 해시 회귀 검증.
- `evidence/account-mail-runtime.json`, `account-mail-export-runtime.json`, `account-mail-verification.json` 및 같은 접두사의 로그 참조.

외부 Resend 발신 도메인·API key로 실제 수신함에 도착하는 검증, Ego hydration·클릭·시각 비교는 미완료다. 로컬 수신기는 외부 수신 증거가 아니다. QA 임시 프로세스와 DB·파일은 정리했다. 전체 사이트 완료로 판정하지 않는다.
