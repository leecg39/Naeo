# MP4·원본 변동 REA 재검증 — 2026-10-16

> 이 문서는 구현 전 조사 기록이다. 사용자의 후속 구현 요청으로 MP4 지원과 홈 런타임 복원이 추가됐다. 현재 계약은 [API 계약](api-contracts.md)의 P7.5와 [후속 구현 기록](mp4-home-implementation-2026-10-16.md)을 따른다.

대상: https://www.naeo.kr/ 및 `/youtube/aeo-intro`. REA 배포 JavaScript 정적 분석과 Ego Lite 실제 화면 관찰을 구분했다. 이번 변경은 검증 기록 정정이며 MP4 인코더 도입이나 원본 화면 자동 복사는 수행하지 않았다.

## 판정

| 질문 | 판정 | 근거 |
|---|---|---|
| MP4가 현재 클론에서 지원되는가? | **아니오. 명시적 미지원이며 지원 기능의 고장으로 분류하지 않는다.** | `exports.ts`의 형식 검증·파일 확장자, DB 제약, `ExportPanel` 안내가 PDF/ZIP으로 일치. PNG는 렌더링·ZIP 수록 이미지다. |
| 원본 영상 페이지에 MP4 다운로드가 있는가? | **조사한 화면과 플레이어 모듈에서는 확인되지 않았다.** | 라이브 페이지는 23장·9:40·AUTO·키보드 제어를 표시하며 관찰 시 버튼·링크가 없었다. 현재 플레이어 번들은 기존 저장본과 SHA-256이 같다. 사이트 전체 또는 서버 기능의 부재를 뜻하지 않는다. |
| 홈 이미지 차이를 모두 캡처 후 신규 섹션으로 볼 수 있는가? | **기존 일괄 판정은 근거가 부족해 정정한다.** | 기존 수집 번들에 해당 이미지 경로와 추가 제목이 이미 존재한다. 수집 HTTP Date는 10-13 02:19 UTC, 화면 캡처는 03:23 UTC. 저장 매니페스트 SHA-256도 모두 일치한다. |
| 실제로 새로 추가된 섹션을 자동 복사하는가? | **자동 복사하지 않는다.** | 버전별 추가 사실을 확인한 경우에만 upstream drift로 분리한다. 기존 클라이언트 콘텐츠의 캡처 누락·동적 렌더링 차이는 별도로 추적한다. |

## MP4 근거와 구현 경계

- [서버 내보내기](../../src/server/creative/exports.ts): `format: 'pdf' | 'zip'`, `z.enum(['pdf','zip'])`; 파일 저장 확장자는 PNG/PDF/ZIP.
- [화면](../../src/components/creative/ExportPanel.tsx): PDF 및 PNG 묶음(ZIP) 버튼과 영상 미지원 안내.
- [마이그레이션](../../src/server/migrations.ts)의 `export_jobs.format`도 PDF/ZIP만 허용한다.
- 라이브 원본 `/_next/static/immutable/chunks/3bua0hcup546f.js`와 기존 `docs/research/naeo.kr/youtube-player-source.js`는 모두 SHA-256 `e49fb02b9d267a1a4d81619badb19dcf336c424b0f4aa135aa247d3b0382b43a`다. 28,403바이트 모듈에서 `mp4`, `MediaRecorder`, `VideoEncoder`, `ffmpeg`, `download`, `export` 문자열은 발견하지 못했다. 이는 해당 파일에 한정한 검색이다.
- 향후 MP4를 추가할 경우 인코딩·시간/전환 규칙·작업 상태·형식/DB 제약·다운로드 및 개인정보 이동성의 파일 포함 규칙까지 새 계약이 필요하다. 현재 PNG 시퀀스의 영상화와 원본 애니메이션의 재현은 서로 다른 범위다.

## 홈 차이의 재분류

기존 캡처와 라이브 페이지 모두 `section`은 12개이며 기본 제목 배열도 같다(히어로의 동적 복제 문자열 제외). 그러나 이것만으로 전체 화면 일치를 판정할 수 없다. 라이브 페이지가 안정된 뒤에는 이미지 49개와 추가 제목 `AI는 누구의 블로그를 읽고 있을까?`가 관찰됐다. 이미지 수는 로그인 아바타·동적 데이터·관찰 시점에도 영향을 받는다.

다음 경로는 기존 수집본에서 이미 확인됐다.

| 자원·콘텐츠 | 기존 번들 예시 | 의미 |
|---|---|---|
| `/landing/profiles/*` | `30j7ne4spedoc.js` | 현재 파일과 SHA-256까지 동일 |
| `/landing/thennow/*` | `1cad5c4csgfvl.js` | 과거 수집본에 자원 참조 존재 |
| `/mcp/post/*`, `/mcp/thumbs/*` | `012v2i4yynoqg.js`, `1p3me3ez20ug8.js` | 과거 수집본에 자원 참조 존재 |
| `/mate/examples/biz.jpg` | `1srs4gb_ghfwi.js`, `3c6sk81pl56rn.js` | 과거 수집본에 자원 참조 존재 |
| `AI는 누구의 블로그…` | `2cb7jbse_j6i2.js` | 과거 수집본에 제목 존재 |

따라서 **캡처 누락 또는 동적 렌더링 차이 가능성**을 열어 두고 복원 범위 검토 대상으로 기록한다. 과거 번들에 코드가 있었다는 사실만으로 당시 사용자에게 실제 표시됐다고 확정하지 않는다. 노출 조건·플래그·데이터 변경 여부는 미확인이다. `/blog` 신규 글 등 다른 차이까지 이번 결론을 확대하지 않는다.

## REA Evidence와 한계

| 범위 | Evidence ID | 분석 |
|---|---|---|
| 홈의 집중 번들 4개 | `ev_24ff0b5ff33d2f1455ffc7712b85c7f39b03ac1922027717b0a0653443c0c53c` | 119,837바이트·AST 28,772개, 파싱 실패 0 |
| 영상 플레이어 1개 | `ev_fa84d8419d0f715fe4bedfa3e6bc234f988d95903f4a90ac3862035f5fb092d5` | 28,403바이트·AST 6,456개, 파싱 실패 0 |

두 분석의 semantic coverage는 `unknown`이다. MCP 응답 크기 제한 후 보존된 전체 Evidence를 파일로 내보냈으며 같은 분석을 반복하지 않았다. 정적 분석은 코드를 실행하지 않았고, 실제 화면 관찰은 Ego Lite로 수행했다. REA의 passive CDP 캡처로 표시하지 않는다.

전체 수집 URL·시각·SHA-256, 과거 매니페스트 대조, 화면 관찰 및 압축 Evidence는 [결과 폴더](../../../reverse-engineering/rea-mp4-drift-2026-10-16/)와 [조사 요약](../../../reverse-engineering/rea-mp4-drift-2026-10-16/README.md)에 있다.

## 이번 검증 실행

- `creative.test.ts`, `creative-http.test.ts`, `exports.test.ts`: 총 8개 통과. 프로젝트 권한·SVG 및 실제 PDF/ZIP 생성·PNG 입력·다운로드·실패·만료·정리를 확인했다. MP4 구현 완료를 의미하지 않는다.
- 신규 보고서의 로컬 링크, Evidence JSON, 현재/과거 플레이어 바이트 일치 및 `git diff --check` 통과.
- 실행 코드·DB·화면은 변경하지 않았다. 전체 테스트·빌드는 이번 문서 정정에서 다시 실행하지 않았다.
