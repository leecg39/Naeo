# NAEO 79URL all-pages clone fidelity final review

- recommendation: APPROVE
- scope: `/Users/user01/Desktop/NAEO/naeo-clone` 현재 워크트리, 브라우저 조작 없이 파일·스크린샷·QA 산출물만 검토
- reviewed at: 2026-10-13

## 판정

현재 확인 가능한 증거 기준으로 앱 자체의 미해결 CRITICAL/HIGH fidelity 버그는 남아 있지 않은 것으로 판정합니다. 이전 HIGH였던 `/youtube/aeo-intro` blank 문제는 해결됐고, `/blog/guide/dashboard-guide` 첫 이미지 문제는 390/768 클론 PNG와 현재 data/CSS/code 증거를 종합하면 앱 버그라기보다 1440 PNG가 이미지 decode 완료 전에 찍힌 캡처 증거 제한으로 보는 것이 타당합니다.

다만 이 제한은 숨기면 안 됩니다. 현재 [docs/design-references/clone/blog--guide--dashboard-guide-1440.png](../../docs/design-references/clone/blog--guide--dashboard-guide-1440.png)는 여전히 첫 본문 이미지 영역이 빈 박스로 남아 있고, 브라우저 작업이 hard stop되어 1440 완료 시점 재촬영은 수행되지 않았습니다. 따라서 이 보고서의 `APPROVE`는 앱 구현과 현재 코드/자산/390·768 캡처 근거에 대한 승인이지, 기존 1440 PNG가 최종 시각 증거로 완전하다는 뜻은 아닙니다.

## CRITICAL

없음.

## HIGH

없음.

## MEDIUM

1. `/blog/guide/dashboard-guide` 1440 데스크톱 PNG는 첫 본문 이미지 decode 완료 전 캡처로 보이며, 완료 시점 재검증이 수행되지 않았습니다.

   - 남아 있는 제한: [docs/design-references/clone/blog--guide--dashboard-guide-1440.png](../../docs/design-references/clone/blog--guide--dashboard-guide-1440.png)의 첫 본문 이미지 영역 crop `(380,430)-(1100,980)`은 bright pixel 0 / green pixel 0으로 빈 박스입니다. 원본 [docs/design-references/naeo.kr/blog--guide--dashboard-guide-viewport-1440.png](../../docs/design-references/naeo.kr/blog--guide--dashboard-guide-viewport-1440.png)는 같은 영역에서 bright pixel 8,909 / green pixel 9,041로 썸네일이 보입니다.
   - 앱 버그로 보지 않는 근거: 같은 페이지의 클론 390 PNG [docs/design-references/clone/blog--guide--dashboard-guide-390.png](../../docs/design-references/clone/blog--guide--dashboard-guide-390.png)는 bright pixel 4,911 / green pixel 2,341이고, 원본 390은 bright pixel 4,914 / green pixel 2,317로 거의 같습니다. 클론 768 PNG [docs/design-references/clone/blog--guide--dashboard-guide-768.png](../../docs/design-references/clone/blog--guide--dashboard-guide-768.png)도 bright pixel 7,839 / green pixel 7,925이고, 원본 768은 bright pixel 7,872 / green pixel 7,899로 정상 표시됩니다.
   - data/CSS 근거: `src/data/pages/blog--guide--dashboard-guide.json`의 첫 이미지 `src`는 `/assets/73f9c7a5d3f7ce21.webp`이고, 해당 이미지 attrs는 `class: "loaded"`를 포함합니다. CSS에는 `.mdx-img-skeleton img { opacity: 0 }`와 `.mdx-img-skeleton img.loaded { opacity: 1 }` 규칙이 함께 있어 loaded 상태에서는 표시되어야 합니다. 실제 [public/assets/73f9c7a5d3f7ce21.webp](../../public/assets/73f9c7a5d3f7ce21.webp)는 정상 썸네일 이미지입니다.
   - renderer 근거: [src/components/captured/NodeRenderer.tsx:90](../../src/components/captured/NodeRenderer.tsx#L90)-[95](../../src/components/captured/NodeRenderer.tsx#L95)는 image load 시 img와 wrapper에 `loaded` class를 붙입니다. [src/components/captured/CapturedView.tsx:91](../../src/components/captured/CapturedView.tsx#L91)-[94](../../src/components/captured/CapturedView.tsx#L94)는 이미 complete/naturalWidth가 있는 skeleton 이미지를 mounted 후 loaded로 보정합니다.
   - QA 제한: [docs/research/visual-qa.json:2074](../../docs/research/visual-qa.json#L2074)-[2128](../../docs/research/visual-qa.json#L2128)은 `/blog/guide/dashboard-guide`를 `brokenImages: []`, `ok: true`로 기록하지만, 1440 screenshot pixel blank 여부까지 검증하지는 않습니다. [docs/research/browser-qa.json:117](../../docs/research/browser-qa.json#L117)-[122](../../docs/research/browser-qa.json#L122)의 “매거진 상세 이미지·목차” 검사도 다른 이미지 `/assets/4816aafefcc1abe1.webp`를 확인합니다.
   - 권장 후속: qa-visual 스크립트에 첫 article image의 `complete`, `naturalWidth`, computed opacity, visible pixel 대기를 추가하세요. 다음에 브라우저를 다시 쓸 수 있을 때 1440 데스크톱 PNG만 재촬영해 evidence gap을 닫는 것이 좋습니다.

2. `/blog/guide/dashboard-guide`의 후반부 일부 이미지는 원본 404 자산으로 남아 있습니다.

   - 증거: [docs/research/naeo.kr/assets-download.json:357](../../docs/research/naeo.kr/assets-download.json#L357)-[402](../../docs/research/naeo.kr/assets-download.json#L402)에 dashboard-guide 5개 이미지가 HTTP 404로 기록되어 있고, [docs/research/naeo.kr/assets.json:239](../../docs/research/naeo.kr/assets.json#L239)-[256](../../docs/research/naeo.kr/assets.json#L256)에 같은 로컬 자산 경로가 매핑되어 있습니다.
   - 영향: 원본 서버 자체가 404를 반환한 근거가 있어 clone 구현 결함으로 보기는 어렵지만, 해당 상세 글 후반 이미지 구간에서 완전한 시각 일치는 제한됩니다.
   - 권장 후속: 원본 404로 인한 제한을 QA/최종 보고서에 명시하고, unavailable placeholder가 의도대로 보이는지 별도 확인하세요.

3. adapter 보정 스타일에 토큰화되지 않은 one-off 값이 아직 남아 있습니다.

   - 증거: [src/components/captured/captured.css:5](../../src/components/captured/captured.css#L5), [src/components/captured/captured.css:14](../../src/components/captured/captured.css#L14)-[15](../../src/components/captured/captured.css#L15), [src/behaviors/landing.tsx:88](../../src/behaviors/landing.tsx#L88)-[96](../../src/behaviors/landing.tsx#L96), [src/behaviors/recommendations.tsx:104](../../src/behaviors/recommendations.tsx#L104), [src/behaviors/recommendations.tsx:148](../../src/behaviors/recommendations.tsx#L148)-[158](../../src/behaviors/recommendations.tsx#L158) 등에 `#03c75a`, `#fff`, inline `style` 보정이 남아 있습니다.
   - 영향: 캡처 DOM을 재현하는 clone 특성상 일부 inline style은 허용 가능하지만, “엄격한 디자인 시스템” 관점에서는 토큰 드리븐으로 정리되지 않은 영역입니다.
   - 권장 후속: 공유 overlay·toast·adapter feedback 색상은 CSS variable 또는 캡처 토큰으로 모아 중복을 줄이세요.

## LOW

1. `docs/design-references/clone/` 밖의 구 검증 PNG가 남아 있으면 리뷰어가 잘못된 산출물을 볼 수 있습니다.

   - 새 기준 폴더 [docs/design-references/clone](../../docs/design-references/clone/)에는 81개 PNG가 있고, 대표로 확인한 home/write/recommendations/video에는 Next dev overlay가 보이지 않았습니다.
   - 권장 후속: 최종 freeze 전에 legacy root-level 검증 PNG를 제거하거나 `archive/`로 이동하세요.

2. 저는 이번 최종 패스에서 build/test를 재실행하지 않았습니다.

   - 이유: 이번 요청이 읽기 전용이며 보고서 외 파일 수정 금지였고, `next build`는 `.next` 산출물을 갱신합니다.
   - 확인한 것: 생성된 QA artifact 기준 [docs/research/route-qa.json](../../docs/research/route-qa.json)은 79/79 통과, [docs/research/visual-qa.json](../../docs/research/visual-qa.json)은 81 rows/bad 0, [docs/research/browser-qa.json:99](../../docs/research/browser-qa.json#L99)-[105](../../docs/research/browser-qa.json#L105)은 video first slide/pause/HUD/advanced true입니다.

## 해결 확인된 이전 HIGH

- `/youtube/aeo-intro` blank: [src/components/StatefulExperience.tsx:9](../../src/components/StatefulExperience.tsx#L9)에서 `/mcp`만 `default`, video/social은 `slide1`로 시작합니다. [src/components/StatefulExperience.tsx:24](../../src/components/StatefulExperience.tsx#L24)-[32](../../src/components/StatefulExperience.tsx#L32)는 `data-naeo-video-stage`를 기준으로 HUD visibility/elapsed/progress를 갱신하고, [src/components/StatefulExperience.tsx:36](../../src/components/StatefulExperience.tsx#L36)에서 실제 fixed stage에 표식을 붙입니다.
- 최신 [docs/design-references/clone/youtube--aeo-intro-1440.png](../../docs/design-references/clone/youtube--aeo-intro-1440.png)은 중앙 대제목과 `▶ AUTO` HUD가 보입니다. 중앙 본문 crop은 bright pixel 38,481 / green pixel 3,325로 원본 수준의 visible content가 있습니다.
- Shared portal hydration: [src/components/captured/SharedDialogs.tsx:22](../../src/components/captured/SharedDialogs.tsx#L22)-[24](../../src/components/captured/SharedDialogs.tsx#L24), [src/components/captured/SharedDialogs.tsx:51](../../src/components/captured/SharedDialogs.tsx#L51)-[52](../../src/components/captured/SharedDialogs.tsx#L52)에서 client mount 이후 portal을 생성합니다.
- recommendations golden/opportunity 필터: [src/behaviors/recommendations.tsx:53](../../src/behaviors/recommendations.tsx#L53), [src/behaviors/recommendations.tsx:118](../../src/behaviors/recommendations.tsx#L118), [src/behaviors/recommendations.tsx:251](../../src/behaviors/recommendations.tsx#L251)-[256](../../src/behaviors/recommendations.tsx#L256)에서 원본 row flag와 카드/버튼 filter state가 연결됩니다.
- live DOM clone 접근: `src` 내에서 `docs/design-references` 스크린샷을 직접 참조하거나 clone PNG를 background로 쓰는 증거는 발견하지 못했습니다. 캡처 JSON과 `NodeRenderer`를 통한 live DOM 렌더 구조가 유지됩니다.

## inspected evidence

- Source/code: `src/components/PageExperience.tsx`, `src/components/StatefulExperience.tsx`, `src/components/captured/CapturedView.tsx`, `src/components/captured/NodeRenderer.tsx`, `src/components/captured/SharedDialogs.tsx`, `src/behaviors/recommendations.tsx`, `src/behaviors/landing.tsx`, `src/components/captured/captured.css`, `src/data/pages/blog--guide--dashboard-guide.json`, `src/data/pages/youtube--aeo-intro.json`.
- QA artifacts: `docs/research/route-qa.json`, `docs/research/visual-qa.json`, `docs/research/browser-qa.json`, `docs/research/naeo.kr/assets.json`, `docs/research/naeo.kr/assets-download.json`.
- Screenshots/assets manually inspected: `docs/design-references/clone/youtube--aeo-intro-1440.png`, `docs/design-references/clone/blog--guide--dashboard-guide-390.png`, `docs/design-references/clone/blog--guide--dashboard-guide-768.png`, `docs/design-references/clone/blog--guide--dashboard-guide-1440.png`, `docs/design-references/naeo.kr/blog--guide--dashboard-guide-viewport-390.png`, `docs/design-references/naeo.kr/blog--guide--dashboard-guide-viewport-768.png`, `docs/design-references/naeo.kr/blog--guide--dashboard-guide-viewport-1440.png`, `public/assets/73f9c7a5d3f7ce21.webp`.

## blockers before approval

없음. 남은 사항은 앱 HIGH 버그가 아니라 1440 데스크톱 캡처 증거 제한과 QA 보강 항목으로 분류합니다.
