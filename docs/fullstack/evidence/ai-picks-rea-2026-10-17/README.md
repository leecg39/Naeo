# AI 인용 현황 (`/dashboard/ai-picks`) REA 분석 및 구현 — 2026-10-17

대상: https://www.naeo.kr/dashboard/ai-picks

로그인된 원본 화면을 Ego Lite에서 읽기 전용으로 관찰하고, 로드된 자사 JavaScript 번들 7개(총 271,638바이트, AST 노드 71,384개, parse failure 0)를 REA(`analyze_javascript_application`)로 정적 분석했다. 분석 원본의 SHA-256, 문자열 바이트 오프셋, REA `evidenceId`(`ev_007174b29741fa7bab05de36b4f629fab43f228132a6165515ce2f8bda5b742c`), 런타임 API 계약은 [source-evidence.json](./source-evidence.json)에 기록했다.

## 원본에서 확인한 구성과 로컬 구현

| 구성 | REA 근거 (`2orb4l9cgigm6.js`, `0vikp-jk811qz.js`) | 로컬 구현 |
| --- | --- | --- |
| 상단 요약 및 핵심 지표 5개 | `전체 글`, `통합검색 노출`, `AI 추천/인용`(텍스트·이미지 분리), `AI 브리핑 노출`, `AI 추천률/인용률` 및 `카테고리별 분포` | [`src/server/analysis/ai-picks-page.ts`](../../../../src/server/analysis/ai-picks-page.ts) |
| 기간·카테고리·상태 필터 및 정렬 | 기간(`전체`, `이번 주`, `이번 달`, `3개월`) 및 카테고리 필터, 상태 필터 4종, 정렬(`최신순`, `검색량순`, `포화도순`) | [`src/behaviors/analysis.tsx`](../../../../src/behaviors/analysis.tsx) |
| 테이블 컬럼 및 도움말 팝오버 | 포스트 카테고리 배지, 포화도 0.5% 미만 초록색 강조(`#03c75a`), `대표 키워드`·`검색량 / 포화도`·`통합검색 노출`·`AI 성과` 4종 상세 설명 다이얼로그 | [`src/server/analysis/ai-picks-page.ts`](../../../../src/server/analysis/ai-picks-page.ts), [`src/behaviors/analysis.tsx`](../../../../src/behaviors/analysis.tsx) |
| 인용 상세 모달 (`AiCheckDetailModal`) | `포스팅 보기`·`링크 복사`, `메인 키워드`·`서브 키워드`·`연관 검색어 (Top 10)` 지표 테이블(`PC`, `Mo`, `전체`, `경쟁강도`, `문서`, `포화`), `AI 브리핑` 마크다운·표·인용 문장 하이라이트(`현재 포스팅` / `내 블로그` 배지), `이미지 출처`·`본문 출처`·`관련 질문`(`검색 >` 및 글쓰기 연동), `대표 키워드 수정` | [`src/server/citations/runs.ts`](../../../../src/server/citations/runs.ts), [`src/behaviors/analysis.tsx`](../../../../src/behaviors/analysis.tsx) |
| 라이트 모드 대비 보정 | `html.light [data-naeo-captured-root="/dashboard/ai-picks"]` 카드·테이블·행 색상 보정 | [`src/server/analysis/ai-picks-page.ts`](../../../../src/server/analysis/ai-picks-page.ts) |

## 근거 보관

원본 상세 캡처·정적 JS·REA 전체 번들은 저장소 외부 `/Users/user01/Desktop/NAEO/reverse-engineering/ai-picks-rea-2026-10-17`에 보관하며, 원본 계정의 비공개 데이터는 앱 런타임 픽스처나 Git 저장소에 포함하지 않는다.

## 검증 결과

- 대상 회귀 테스트 (`ai-picks-page`, `citations`, `citations-http`, `dashboard-visualization`): **20개 통과** — [tests-targeted.txt](./tests-targeted.txt)
- 전체 테스트 (`npm test`): **전체 통과** — [tests-full.txt](./tests-full.txt)
- 타입 검사 (`npm run typecheck`): **통과** — [typecheck.txt](./typecheck.txt)
- 린트 (`npm run lint`): **통과** — [lint.txt](./lint.txt)
- 프로덕션 빌드 (`npm run build`): **통과** — [build.txt](./build.txt)
