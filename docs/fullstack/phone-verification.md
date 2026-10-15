# 휴대폰 번호 인증 — 스키마 32

2026-10-15 · P1.7 구현 진행. 원본 REA는 휴대폰 인증 조건과 보상 안내를 확인했지만 원본 SMS 공급자·실제 서버 정책은 미확인이다. Twilio Verify 연동은 클론의 별도 설계다.

## 사용자 흐름

연락처를 저장하고 설정의 ‘인증 문자 요청’을 누른다. 국내 `010` 번호는 `+82` 형식으로 정규화하고, 다른 번호는 국가번호를 포함한 E.164 형식을 요구한다. 입력 코드를 공급자에 확인하고 승인 응답을 받은 경우에만 현재 연락처의 인증 시각을 저장한다. 번호 보유 확인이며 법적 실명 확인이나 신분 증명이 아니다.

- GET `/api/auth/phone/status`: 설정 가능 여부·본인 요청 상태/횟수/만료 시각. 공급자 ID·세션 해시·코드는 노출하지 않는다.
- POST `/api/auth/phone/request`, `{}`: 현재 저장된 본인 번호로 명시적 요청. 성공 202. 임의 수신자 필드는 거절한다.
- POST `/api/auth/phone/check`, `{code}`: 숫자 4–10자리, 본인 요청과 해당 로그인 세션에 묶어 검증한다.

인증·Origin·엄격한 입력 검사 외에 peer 시간당 30회, 요청 사용자/정규화 번호당 시간당 5회, 코드 검증 사용자당 시간당 20회, 요청 간 60초 대기를 적용한다. 코드 불일치는 5회까지 허용하며 요청 자체는 10분 만료다. API와 화면은 공급자 미설정을 이용 불가로 표시한다.

## 저장·동시성·실패 처리

`sms_challenges`는 연락처와 로그인 세션에 FK cascade로 연결된다. 현재 연락처 버전, 정규화 번호, 공급자 service와 verification SID, 상태·시도·만료·lease를 저장하며 **OTP 코드는 저장하지 않는다**. 연락처 수정/삭제, 계정 상태·비밀번호·이메일·역할 변경, 세션 삭제는 대기 요청을 폐기한다.

외부 통신 전 트랜잭션에서 확인 작업을 독점하고 완료 때 세션·계정·요청·만료·lease·번호·연락처 버전을 다시 검사한다. 연락처 인증 성공은 버전을 증가시키며 요청을 삭제한다. 동시에 시작한 확인 요청은 거절된다. 공급자 실패 또는 결과가 불확실하면 인증하지 않는다. 전송/확인 결과를 잃었거나 프로세스가 중단된 경우 60초 이후 새 요청을 시작할 수 있다. 자동 문자 재전송은 하지 않는다.

만료 행은 worker 보관 정리에서 삭제한다. 개인정보 내보내기는 안전한 요청 상태 metadata를 추가해 44개 데이터셋이며 공급자 SID·세션 해시는 제외한다.

## 공급자 계약과 설정

[Twilio Verification API](https://www.twilio.com/docs/verify/api/verification)의 SMS 요청과 [Verification Check API](https://www.twilio.com/docs/verify/api/verification-check)의 코드 확인을 사용한다. API key/secret의 Basic 인증과 form encoding을 사용하며 응답의 계정·service·전화번호·SMS 채널·verification SID·상태를 대조한다. 요청 성공은 pending이어야 하며 코드 확인의 approved만 인증으로 처리한다. 수동 상태 승인 API는 사용하지 않는다.

환경 설정: `NAEO_SMS_PROVIDER=twilio-verify`, `NAEO_TWILIO_ACCOUNT_SID`, `NAEO_TWILIO_VERIFY_SERVICE_SID`, `NAEO_TWILIO_API_KEY`, `NAEO_TWILIO_API_SECRET`. 운영 endpoint는 `https://verify.twilio.com`이며 테스트 override는 HTTP loopback만 허용한다. 응답 크기 16KiB, 타임아웃 10초, redirect 금지. 자격 증명과 OTP를 로그에 기록하지 않는다.

실제 운영에는 Twilio 서비스·발신/수신 지역 설정·권한이 필요하며 실제 단말 수신과 승인 왕복은 아직 검증하지 않았다. 로컬 공급자 승인을 실제 통신사 수신 증거로 표시하지 않는다.

## 검증과 미완료 범위

- 신규 8개 테스트: 정규화/승인/일회성, 연락처 변경·로그아웃 중 늦은 응답, 다른 세션, 오답 5회, 만료, 동시 확인, 공급자 없는 상태, API 권한/Origin/입력, 실제 loopback HTTP와 잘못된 번호 응답·설정·redirect/429/과대 응답.
- 전체 389개(기반 6 + 서버 383), lint/typecheck/build 검증. `sms-verification.json`과 로그 참조.
- 실제 production Next: 가입→연락처 저장→문자 요청→60초 재요청 제한→오답 미인증→승인 인증→재사용 거절→번호 변경 해제→로그아웃 차단. 실제 local HTTP 공급자 요청 3회, 외부 SMS 0회.
- 개인정보 TAR 44개 데이터셋·첨부 1개, 소유권/해시 및 로그아웃 차단 회귀 확인.

Ego hydration·클릭·시각 비교, 실제 단말 수신, 번호 중복 보상 검증은 미완료다. **P10.4의 휴대폰 인증 120P 보상은 아직 지급하지 않는다.** 다음 단계는 인증된 번호에 대한 중복 지급 방지·계정 삭제 후 중복 수령 정책·원장 원자성을 구현/검증하는 것이다. P1.7/P10.4 및 전체 목표를 완료로 처리하지 않는다.
