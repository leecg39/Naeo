# 배포·외부 연동 준비물 정리 (2026-10-16)

이 문서는 "코드는 구현됐고 로컬에서 검증됐지만, 실제 운영 동작은 외부 계정·키·등록이 있어야만 확인할 수 있는" 항목을 모은다. 어떤 것이 없으면 해당 기능은 미설정으로 표시되고 조용히 건너뛰며(503/미설정 표시), 서비스 자체는 켜진다.

## 1. 인프라(필수)

| 항목 | 요구 | 이유 |
|---|---|---|
| 서버 | Node `^22.16 \|\| >=24`, 지속 볼륨이 있는 단일 호스트 | SQLite 파일과 업로드 폴더를 쓰므로 serverless/stateless 불가 |
| 프로세스 | `npm start`(웹) — in-process 작업자가 큐를 함께 처리. 분리하려면 `npm run worker` 추가 + `NAEO_INPROCESS_WORKER`는 취향 | 큐·정기 작업 처리(알림 메일·자동 스캔·보내기·보관 정책 포함), lease로 중복 실행 방지 |
| 도메인 | 공개 HTTPS origin → `NAEO_APP_URL` | OAuth 콜백·결제 웹훅·MCP 주소·Secure 쿠키가 실제 origin에 묶임 |
| MP4 | FFmpeg/libx264 + 웹과 같은 환경의 worker | 무음 H.264 슬라이드 영상 인코딩 |
| 기타 | `NAEO_TRUST_PROXY=1`(프록시 뒤일 때), `NAEO_ALLOW_INDEXING=1`(검색 노출 허용 시) | — |

## 2. 외부 연동 준비물(기능별)

| 기능 | 필요한 것 | 등록해야 할 콜백/설정 | 없으면 |
|---|---|---|---|
| AI 글 생성 | `ANTHROPIC_API_KEY`(+선택 `NAEO_AI_BASE_URL`) | — | 생성 요청 503(차감 없음) |
| 회원 ChatGPT 연결·AI 생성 | OpenAI 승인 서비스 client `NAEO_OPENAI_CLIENT_ID`(oaiapp_…), `NAEO_OPENAI_TOKEN_ENCRYPTION_KEY`, (기밀 client면 secret) | `{APP}/api/account/openai/callback` HTTPS | 설정 화면에 '미설정' |
| AI 이미지 생성 | `NAEO_IMAGE_PROVIDER`+`NAEO_IMAGE_API_KEY` | — | `aiImages>0` 요청 503(차감 없음) |
| 메일(계정·문의·알림) | `NAEO_EMAIL_PROVIDER=resend`, `NAEO_RESEND_API_KEY`, `NAEO_MAIL_FROM`, `NAEO_MAIL_ENCRYPTION_KEY`, `NAEO_APP_URL` | Resend 발신 도메인 검증 | 큐에 넣지 않음/재설정 메일 없음 |
| SMS 인증 | Twilio Verify 4종(`NAEO_TWILIO_*`+`NAEO_SMS_PROVIDER`) | — | 인증 미제공 |
| 휴대폰 보상 | `NAEO_PHONE_REWARD_KEY`(64hex, 별도 보관) | — | 보상 미지급 |
| 결제 | `NAEO_TOSS_CLIENT_KEY`·`NAEO_TOSS_SECRET_KEY` | 웹훅 `{APP}/api/billing/webhooks/toss` | 결제 미제공 |
| 소셜 로그인 | Google·Naver 앱 각각 client id/secret | `{APP}/api/auth/oauth/{google,naver}/callback` | 버튼 비활성 |
| AI 인용 확인 | `NAEO_CITATION_PROVIDER`+`NAEO_SERPAPI_KEY` | — | 인용 섹션 '미설정' |
| 키워드 지표(관리자) | `NAEO_SEARCHAD_API_KEY`·`NAEO_SEARCHAD_SECRET`·`NAEO_SEARCHAD_CUSTOMER_ID` | 검색광고 센터 API 라이선스 | '미설정', 수동 입력만 |
| 키워드 상위 노출·문서 수 | `NAEO_NAVER_CLIENT_ID`·`NAEO_NAVER_CLIENT_SECRET` | developers.naver.com 앱 | '미설정' |
| 확장 프로그램 | `NAEO_EXTENSION_IDS`(스토어 등록 후 고정 ID) | Chrome Web Store 심사·게시 | 확장 연결 거절 |

네이버 블로그 RSS는 공개 피드라 키가 없다. `NAEO_RSS_BASE`를 포함한 `*_BASE` 테스트 오버라이드는 루프백만 허용하고 운영에 설정하지 않는다.

## 3. 배포 후에만 완료되는 검증

로컬 double 검증을 실제 공급자 성공으로 세지 않는다. 아래는 실제 키/등록이 생긴 뒤 확인할 것:

1. Resend: 재설정·인증·문의 답변·알림 메일이 실제 수신함에 도착, 발신 도메인 SPF/DKIM 통과.
2. Twilio: 실제 단말기 OTP 수신·검증, 지역 발신 제한 확인.
3. Toss: 테스트 결제창 승인→웹훅 반영→취소/환불, 실패 시 복구 큐.
4. Google/Naver: 실제 계정 로그인 왕복, 리디렉션 승인.
5. OpenAI: 승인된 client로 회원 연결→글 생성→토큰 갱신→해제 왕복.
6. OpenAI Images: 실제 이미지 생성·콘텐츠 정책 거절 처리·요금.
7. SerpApi·검색광고·네이버 검색: 실제 키 왕복과 응답 계약 확인, 일일 한도/비용.
8. 확장: 스토어 배포 ID로 `/auth/extension` 연결과 네이버 편집기 전달.
9. MCP: 배포 origin에서 공식 Inspector·ChatGPT/Claude 커넥터 연결.

## 4. 운영 시 사람이 정할 것

- 원본에서 가져온 정책·FAQ·기사 문구, 바닥글 SNS/연락처, 요금제 가격·혜택.
- 공지·이벤트·랭킹 리워드 실제 운영 값.
- 백업 일정과 개인정보 보관 기간(`operations.md`의 백업은 기록기 정지 후 오프라인 실행).
- `NAEO_OPENAI_TOKEN_ENCRYPTION_KEY`·`NAEO_MAIL_ENCRYPTION_KEY`·`NAEO_PHONE_REWARD_KEY`는 분실 시 각각 회원 토큰 복구 불가·대기 메일 폐기·보상 지급 중단이라 별도 비밀 저장소에 보관.
