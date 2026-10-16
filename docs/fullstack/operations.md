# 운영 안내

이 서비스는 Next.js 서버 하나와 작업자(worker) 하나, SQLite 파일, 업로드 폴더로 동작한다. 지속 볼륨이 없는 serverless 환경에는 배포하지 않는다.

## 환경 분리
| 환경 | `NAEO_DATABASE_PATH` | `NAEO_UPLOAD_DIR` | `NAEO_APP_URL` | 비고 |
|---|---|---|---|---|
| 운영 | 지속 볼륨의 별도 파일(예: `/srv/naeo/naeo.sqlite`) | `/srv/naeo/uploads` | `https://실제-도메인` | 외부 키 설정, `NAEO_ALLOW_INDEXING=1`은 실제 도메인에서만 |
| 개발 | `var/naeo.sqlite` | `var/uploads` | `http://127.0.0.1:3000` | `npm run dev` |
| QA | `var/qa/foundation.sqlite` | `var/qa/uploads` | `http://127.0.0.1:3100` | 검증용, 운영 데이터와 섞지 않음 |

`NAEO_TOSS_API_BASE`, `NAEO_OAUTH_ENDPOINT_BASE`, `NAEO_OPENAI_OAUTH_BASE`, `NAEO_OPENAI_API_BASE`는 로컬 스텁 검증 전용이라 loopback만 허용하며 운영에는 설정하지 않는다. 모든 변수는 `.env.example`에 있고, 비밀값(키·시크릿)은 저장소에 넣지 않는다.

회원별 ChatGPT 연결은 OpenAI에서 승인받은 배포 서비스용 `NAEO_OPENAI_CLIENT_ID`(`oaiapp_…`)와 64자리 hex `NAEO_OPENAI_TOKEN_ENCRYPTION_KEY`가 모두 있어야 활성화된다. confidential client라면 `NAEO_OPENAI_CLIENT_SECRET`도 설정한다. 공급자에 등록하는 콜백은 `${NAEO_APP_URL}/api/account/openai/callback`과 정확히 같아야 한다. 웹과 worker는 같은 암호화 키를 써야 하며 키를 잃으면 보관 중인 회원 토큰을 복구할 수 없으므로 연결을 삭제하고 재인증해야 한다. 기존 Codex/ChatGPT 로그인 토큰을 이 값으로 복사하지 않는다.

## 실행
```bash
npm ci
cp .env.example .env.local        # 값 채우기
npm run build
npm start                          # 웹(포트는 package.json 또는 next start 옵션)
npm run worker                     # 작업자: 개인정보 내보내기·진단·글 생성 큐, 1분마다 구독 기간 처리·주문 만료·내보내기 정리, 1시간마다 보관 정책
```
웹과 작업자는 같은 `NAEO_DATABASE_PATH`·`NAEO_UPLOAD_DIR`을 써야 한다. 관리자 계정은 `/login`에서 가입한 뒤 `npm run admin -- promote 이메일`로 승격한다(기본 관리자·공유 비밀번호 없음).

Next.js 웹 서버는 `.env.local`을 읽지만 위 Node CLI들은 자동으로 읽지 않는다. 셸에서 환경 변수를 전달하거나, 환경 파일을 사용한다면 `node --env-file=.env.local --import tsx scripts/worker.ts`처럼 명시한다. 관리자·백업·복원 CLI에도 같은 방식으로 올바른 DB·업로드 경로를 전달한다.

## 마이그레이션
DB를 열 때 `src/server/migrations.ts`의 새 버전이 한 트랜잭션으로 자동 적용된다. 적용된 버전은 체크섬으로 고정되어, 이미 적용된 마이그레이션을 고치면 서버가 시작을 거부한다(새 번호로 추가해야 한다). 현재 상태는 `GET /api/health`의 `schemaVersion`과 관리자 운영 현황에서 확인한다.

개발 서버가 실행 중인 동안 새 마이그레이션을 추가하면 hot reload만으로 DB가 다시 열리지 않을 수 있다. 2026-10-16 OpenAI 연결 검증에서 이전 스키마 37 프로세스가 새 테이블을 읽어 설정 화면이 500이 되는 것을 재현했다. 마이그레이션 변경 뒤에는 웹과 worker를 모두 재시작하고 `/api/health`가 현재 버전을 반환하는지 확인한다(2026-10-16 기준 45).

## 재시작
1. 웹 프로세스를 멈추고 `npm run build` 후 `npm start`.
2. 작업자도 멈춘 뒤 다시 시작한다(코드가 바뀌면 반드시). 작업 중이던 항목은 임대 시간이 지나면 다른 작업자가 다시 가져가고, 최대 시도 횟수를 넘으면 실패·환급으로 끝난다.
3. `/admin` 서비스 상태에서 작업자 신호(2분 안)와 큐를 확인한다. 막 재시작하면 멈춘 작업자의 마지막 신호가 2분 동안 함께 보인다.

## 백업·복원
```bash
# 백업과 복원 모두 웹·작업자·기타 DB/업로드 기록기를 먼저 정지
npm run backup -- /srv/naeo/backups --offline
npm run restore -- /srv/naeo/backups/naeo-YYYY-MM-DDTHH-MM-SSZ --offline --force
# 복원이 중단되어 restore-pending.json이 남았을 때, 기록기를 정지한 상태에서
npm run restore -- --offline --recover
```
`--offline`은 운영자가 기록기를 멈췄다는 확인이며 실행 중인 서버를 자동 종료하거나 모든 기록기를 탐지하지 않는다. DB의 `VACUUM INTO`만으로는 업로드와 같은 시점의 사본을 만들 수 없어 온라인 백업 안내를 수정했다. 백업·복원 CLI에도 동일한 `NAEO_DATABASE_PATH`와 `NAEO_UPLOAD_DIR`을 지정한다. 예약 실행에는 기록기 정지·재개 절차도 포함해야 한다.

백업 형식 2는 DB와 각 업로드의 SHA-256·크기·목록, 테이블 건수, 스키마 버전을 저장한다. 복원 전 SQLite 무결성·외래키·마이그레이션 체크섬까지 읽기 전용으로 검사한다. 업로드 손상·누락·추가, 경로 겹침·심볼릭 링크를 거절한다. 기존 형식 중 기록과 실제 업로드가 모두 0개인 백업은 같은 DB 검증 후 복원할 수 있다. 업로드가 있는 기존 형식은 당시 파일 체크섬이 없어 자동 복원 대상에서 제외되며 원본을 보존하고 새 백업을 만들어야 한다. 외래키 등 무결성 검증을 통과하지 못한 백업은 파일 수와 관계없이 자동 복원을 거절한다.

복원은 임시 사본에서 검증·마이그레이션을 끝낸 뒤 기존 DB·WAL·SHM·업로드를 각각 `.before-restore-시각`으로 보존한다. `--force` 없이 DB 또는 업로드가 있으면 거절하고 보존 사본도 덮어쓰지 않는다. DB와 업로드는 각 대상과 같은 파일시스템의 임시 위치에서 설치한다. 도중 오류는 이전 상태로 되돌리고, 강제 종료 시에는 `<DB 경로>.restore-pending.json`을 남겨 서버의 새 DB 연결을 차단한다. `--recover`는 커밋 전에는 원래 자료로 복구하고, 커밋 후에는 설치된 자료를 유지하며 임시 상태만 정리한다. 실행 중인 복원 PID가 있거나 보존 사본의 해시가 달라지면 복구도 거절하고 증거를 유지한다.

복원 기록·`.before-restore-*`·`.naeo-restore-*`·`.naeo-uploads-*`를 작업 중 수동 삭제하지 않는다. 기록 게시 전 프로세스가 중단되면 기존 자료는 바뀌지 않지만 임시 폴더·JSON 임시 파일이 남을 수 있다. 운영자가 실행 중인 작업과 pending 기록이 없음을 확인한 뒤 정리한다. 보존 사본과 백업의 개인정보 보관 기간은 별도 운영 정책으로 관리한다. [검증 범위](backup-recovery.md).

## 보관 정책(작업자가 1시간마다)
최근 저장 후 30일 지난 글 초안, 방문 원본 30일(일별 집계는 보존), 방문자 salt 2일, 감사 로그 1년, 하루 지난 작업자 기록, 만료된 세션·인가 코드·자체 OAuth state·OpenAI 연결 state 즉시, 만료 30일 지난 자체 OAuth 토큰. 회원 OpenAI 연결 토큰은 연결 해제·회원 탈퇴·최종 갱신 오류 때 삭제한다. 초안 자동 삭제 시 버전 이력과 공유 링크도 삭제하며 연결 사진은 내 사진함에 남긴다. 제작 내보내기 파일 7일(주인 없는 파일은 1시간 뒤). 개인 데이터 TAR는 요청 후 최대 1시간이며 세션 철회·탈퇴 시 삭제 큐로 회수한다. 결제·환불은 회계 기록이라 삭제하지 않는다(트리거로 보호, 회원 탈퇴 후에도 보존).

## 점검
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`
- 경로 감사: `NAEO_AUDIT_EMAIL=… NAEO_AUDIT_PASSWORD=… npm run audit:routes`(서버 실행 중, 관리자 계정) → `docs/fullstack/page-coverage.json`
- Ego 화면 점검: `node scripts/run-browser-qa.mjs 0`부터 `8`까지(기존 작업 공간 기본 7, 관리자 로그인). 셸 환경은 Ego 내부 Node로 자동 전달되지 않으므로 이 실행기가 주소·경로·배치 번호만 명시적으로 전달한다. 결과는 `docs/fullstack/browser-qa/`.
- 운영 전 교체: 원본 사이트에서 가져온 정책 문서·FAQ·기사·바닥글 SNS 링크·연락 메일, 요금제 가격·혜택


## 사진 삭제 복구 (스키마 26)

사진 삭제와 회원 탈퇴는 `media_deletions`에 파일 삭제 대상을 남긴다. 접근은 DB 삭제 시 차단되며, 작업자가 1분마다 최대 100건을 처리한다. 파일이 이미 없으면 완료로 처리하고 IO 오류가 나면 큐를 보존해 재시도한다. 관리자 서비스 상태의 삭제 대기·재시도 건수와 작업자 `media cleanup` 로그를 확인한다. 권한 오류에서는 업로드 폴더의 경로·접근 권한을 바로잡고 작업자를 유지한다. 큐 행을 임의 삭제하면 물리 삭제 복구 근거를 잃는다.

기존 버전에서 남은 파일은 업로드 루트의 서비스 UUID 파일명(JPG/PNG/WEBP), DB 미참조, 수정 후 1시간 경과 조건을 모두 만족할 때 회수한다. 현재 참조 파일·최근 파일·다른 이름·하위 폴더는 제외한다. 내보내기 폴더 정리는 기존 별도 정책을 유지한다. 백업 파일의 개인정보까지 이 작업자가 지우지는 않으므로 백업 보관·복원 시 삭제 반영 정책을 별도로 관리해야 한다.

비밀번호 변경 및 관리자의 계정 상태·역할 변경은 로그인 세션과 외부 앱 토큰/인가 코드를 철회한다. 외부 앱은 다시 연결해야 한다. 앱 연결 해제는 아직 교환하지 않은 인가 코드도 무효화한다.

## 개인 데이터 내보내기

[계약·검증](personal-data-export.md). 스키마 29, `npm run worker` 필요. `personal_exports`가 준비 상태를, `personal_export_deletions`가 삭제 재시도를 보존한다. worker 로그의 `personal export cleanup`에서 `failed/scanError`가 있으면 업로드 폴더 권한·디스크 상태를 확인한다. 쿠키·비밀번호·아카이브 내용을 로그에 남기지 않는다. 요청 1시간 만료, 10분 lease, 최대 3회 중단 복구이며 브라우저는 TAR를 스트리밍 다운로드한다. 이 파일을 공용 정적 경로에 노출하지 않는다.

## 계정 메일 (스키마 30)

`.env.example`의 Resend 공급자·API key·발신 이메일·32바이트 암호화 키 및 NAEO_APP_URL을 설정한다. 웹과 worker에 같은 암호화 키를 제공하고 키는 DB 백업과 별도 비밀 저장소에서 보존한다. 키를 잃으면 기존 대기 본문은 복호화할 수 없으며 PAYLOAD_UNREADABLE로 종료된다. 키·서비스 origin·발신자 교체 전 대기 항목 상태를 확인하고 필요하면 사용자에게 새 링크 요청을 안내한다. 토큰 TTL은 최대 60분이다.

기존 `npm run worker`가 계정 메일을 처리한다. 운영 현황에는 pending/failed 수와 설정 여부만 노출한다. 공급자 accepted는 실제 수신 도착이 아니다. 실제 공급자 key나 수신자 정보를 검증 로그에 남기지 않는다. 자세한 API/재시도/로컬 QA는 `account-mail.md` 참조.

## 문의 답변 메일 (스키마 31)

계정 메일과 같은 환경 설정·worker를 사용한다. 관리자가 답변 저장 후 별도 발송 요청해야 큐에 들어간다. 23시간 만료, 최대 5회 동일 키/본문 재시도. 관리자 문의 상세의 mailState가 상태 기준이다. 공급자 접수는 수신 완료가 아니며 실패 후 중복 발송을 막기 위해 새 키 자동 재발송은 하지 않는다. 자세한 운영/삭제 한계는 inquiry-mail.md 참조.

## 알림 메일·자동 스캔 (스키마 43)

회원 알림은 `notify_mail` 아웃박스를 같은 메일 설정과 worker로 보낸다. 분석 완료 메일은 `scan_email` 동의 회원에게 진단마다 한 통(점수·수집 수·대시보드 링크), 혜택 메일은 `marketing_email` 동의 회원에게 리워드 지급 시 발송하고 리워드 회수 시 대기 항목을 회수한다. 발송 직전 동의를 다시 확인해 동의 철회 후에는 보내지 않으며, 메일 설정이 없으면 큐에 넣지 않는다. `autoscan` 동의 회원의 대표 블로그는 유지 주기에서 KST 하루 1회까지 자동 진단이 예약된다(실패·취소 포함 하루 한 번, 진행 중·한도 초과·비활성은 건너뜀). 운영 현황의 회원 알림 큐에서 pending/failed를 확인한다.

## MP4 내보내기 (스키마 45)

웹 서버와 `npm run worker`가 같은 DB·업로드 폴더를 사용해야 한다. 양쪽 실행 환경에 H.264 `libx264` 인코더가 포함된 FFmpeg를 설치하고 `NAEO_FFMPEG_PATH`에 실행 파일 경로를 설정한다. 비어 있으면 PATH의 `ffmpeg`를 사용한다. `ffmpeg -hide_banner -encoders`에서 `libx264`를 확인할 수 있다. 배포 머신에 별도로 설치해야 하며 npm 패키지가 FFmpeg를 설치해 주지는 않는다.

회원의 PNG 장면 전송이 끝나면 작업은 `queued`가 되고 worker에서 `encoding`→`succeeded` 또는 `failed`로 진행한다. worker가 없으면 대기 상태가 유지되므로 웹 서버와 함께 실행한다. 인코더 사용 불가 시 새 요청은 503 `EXPORT_ENCODER_UNAVAILABLE`이다. 사용자 취소는 `canceled`, 서비스 정상 종료는 재개 가능한 `queued`로 돌아간다. 비정상 종료된 작업은 30초 lease 만료 후 최대 3회 시도한다.

장당 1~30초(기본 3초), 최대 20장·600초, 무음·30fps·H.264/yuv420p로 저장한다. 장면 전환 효과는 없다. 작업당 5분·256MB로 제한하고 DB당 인코딩은 한 개씩 처리한다. 회원별 진행 중 2개·전체 32개 제한을 둔다. 생성 파일은 임의 이름의 비공개 업로드 경로에 저장하고 소유자만 인증 다운로드할 수 있다. 완성 후 7일 보관하며 취소·실패·삭제·만료의 임시 파일은 정리한다. 강제 종료로 남은 작업 폴더는 정기 정리 대상이다.

## SMS 인증

Twilio Verify 계정·service·API key·secret을 .env.example에 따라 설정한다. OTP 자체는 공급자가 생성/검사하며 앱은 보관하지 않는다. 자동 SMS 재전송은 하지 않는다. 만료 요청은 worker retention에서 삭제한다. 실제 단말 수신·지역 설정 검증이 필요하며 설정만으로 검증 완료로 간주하지 않는다. phone-verification.md 참조.

## 휴대폰 보상 키

별도 NAEO_PHONE_REWARD_KEY(64자리 hex)를 웹 서버에 설정한다. 최초 지급 후 DB의 digest와 다른 키면 지급을 거절한다. DB와 별도로 안전하게 백업하고 키 분실 시 신규 키로 초기화하지 않는다. 계정 삭제 후에도 계정 연결 없는 번호 HMAC/지급 시각은 중복 수령 방지를 위해 보존된다. phone-reward.md 참조.
