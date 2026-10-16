# TASKS 계정 후속 검증 증거

[수정·검증·남은 조건](../../tasks-finish-2026-10-16.md). 실제 외부 메일·SMS 발송 없이 프로덕션 Next + worker + 로컬 HTTP 공급자를 Ego Lite로 조작했다.

- 자동 검사: [490개 테스트](tests.txt), [lint](lint.txt), [typecheck](typecheck.txt), [프로덕션 빌드](build.txt).
- 이메일: [수정 전](email-before.json), [수정 후·링크 재사용 거절](email.json), [390px 화면](email-mobile.png).
- 휴대폰: [수정 전](sms-before.json), [수정 후·틀린 코드](sms.json), [390px 화면](sms-mobile.png).
- 비밀번호: [수정 전](password-before.json), [복구·로그인 결과](password.json), [390px 성공 화면](reset-mobile.png).
- 계정: [연락처·알림·120P](contact-preferences.json), [다른 기기 철회](sessions.json), [암호 변경·재인증 탈퇴](security.json), [탈퇴 후 DB](deletion.json).

`BODY` 포커스는 수정 후 `role=status`인 성공 안내로 복원됐다. 비밀번호·세션 쿠키·실제 인증 링크·SMS 코드는 증거에 저장하지 않았다. 화면 조작 중 선택자가 중복되거나 Next 안내 영역이 먼저 관찰된 경우에는 현재 DOM을 확인한 뒤 선택자를 좁혀 계속했다. 검증 결과는 의도한 최종 화면과 API/DB 상태 기준이다.
