# 운영 안내

이 서비스는 Next.js 서버 하나와 작업자(worker) 하나, SQLite 파일, 업로드 폴더로 동작한다. 지속 볼륨이 없는 serverless 환경에는 배포하지 않는다.

## 환경 분리
| 환경 | `NAEO_DATABASE_PATH` | `NAEO_UPLOAD_DIR` | `NAEO_APP_URL` | 비고 |
|---|---|---|---|---|
| 운영 | 지속 볼륨의 별도 파일(예: `/srv/naeo/naeo.sqlite`) | `/srv/naeo/uploads` | `https://실제-도메인` | 외부 키 설정, `NAEO_ALLOW_INDEXING=1`은 실제 도메인에서만 |
| 개발 | `var/naeo.sqlite` | `var/uploads` | `http://127.0.0.1:3000` | `npm run dev` |
| QA | `var/qa/foundation.sqlite` | `var/qa/uploads` | `http://127.0.0.1:3100` | 검증용, 운영 데이터와 섞지 않음 |

`NAEO_TOSS_API_BASE`, `NAEO_OAUTH_ENDPOINT_BASE`는 로컬 스텁 검증 전용이라 localhost만 허용하며 운영에는 설정하지 않는다. 모든 변수는 `.env.example`에 있고, 비밀값(키·시크릿)은 저장소에 넣지 않는다.

## 실행
```bash
npm ci
cp .env.example .env.local        # 값 채우기
npm run build
npm start                          # 웹(포트는 package.json 또는 next start 옵션)
npm run worker                     # 작업자: 진단·글 생성 큐, 1분마다 구독 기간 처리·주문 만료·내보내기 정리, 1시간마다 보관 정책
```
웹과 작업자는 같은 `NAEO_DATABASE_PATH`·`NAEO_UPLOAD_DIR`을 써야 한다. 관리자 계정은 `/login`에서 가입한 뒤 `npm run admin -- promote 이메일`로 승격한다(기본 관리자·공유 비밀번호 없음).

## 마이그레이션
DB를 열 때 `src/server/migrations.ts`의 새 버전이 한 트랜잭션으로 자동 적용된다. 적용된 버전은 체크섬으로 고정되어, 이미 적용된 마이그레이션을 고치면 서버가 시작을 거부한다(새 번호로 추가해야 한다). 현재 상태는 `GET /api/health`의 `schemaVersion`과 관리자 운영 현황에서 확인한다.

## 재시작
1. 웹 프로세스를 멈추고 `npm run build` 후 `npm start`.
2. 작업자도 멈춘 뒤 다시 시작한다(코드가 바뀌면 반드시). 작업 중이던 항목은 임대 시간이 지나면 다른 작업자가 다시 가져가고, 최대 시도 횟수를 넘으면 실패·환급으로 끝난다.
3. `/admin` 서비스 상태에서 작업자 신호(2분 안)와 큐를 확인한다. 막 재시작하면 멈춘 작업자의 마지막 신호가 2분 동안 함께 보인다.

## 백업·복원
```bash
npm run backup -- /srv/naeo/backups            # 실행 중에도 가능(VACUUM INTO), 업로드 폴더 복사, manifest(체크섬·표별 건수)
# 복원: 웹·작업자를 멈춘 뒤
npm run restore -- /srv/naeo/backups/naeo-YYYY-MM-DDTHH-MM-SSZ --force
```
복원은 체크섬을 확인하고, 기존 DB·WAL·업로드를 `.before-restore-시각`으로 옮겨 보존한 뒤 복사하고, 다시 열어 마이그레이션을 적용한다. `--force` 없이 대상이 있으면 거절한다. 백업 폴더는 매번 새로 만들어 덮어쓰지 않는다. 정기 백업은 cron 등으로 `npm run backup`을 실행하고 오래된 백업은 운영 정책에 맞게 지운다.

## 보관 정책(작업자가 1시간마다)
방문 원본 30일(일별 집계는 보존), 방문자 salt 2일, 감사 로그 1년, 하루 지난 작업자 기록, 만료된 세션·인가 코드·OAuth state 즉시, 만료 30일 지난 OAuth 토큰. 내보내기 파일 7일(주인 없는 파일은 1시간 뒤). 결제·환불은 회계 기록이라 삭제하지 않는다(트리거로 보호, 회원 탈퇴 후에도 보존).

## 점검
- `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`
- 경로 감사: `NAEO_AUDIT_EMAIL=… NAEO_AUDIT_PASSWORD=… npm run audit:routes`(서버 실행 중, 관리자 계정) → `docs/fullstack/page-coverage.json`
- 운영 전 교체: 원본 사이트에서 가져온 정책 문서·FAQ·기사·바닥글 SNS 링크·연락 메일, 요금제 가격·혜택
