# NAEO 79 URL Clone Fidelity Review

recommendation: REQUEST_CHANGES

## Scope

- Goal reviewed: clone all pages listed in `/Users/user01/Desktop/NAEO/reverse-engineering/page.md`.
- Repository reviewed: `/Users/user01/Desktop/NAEO/naeo-clone`.
- Current clone shape: `src/data/page-index.json` maps 61 live renderable routes. The remaining 18 URLs are represented by redirects or intentionally unavailable admin/banner/update-detail paths, matching the stated 61 화면 + 18 리디렉션/접근제한 scope.
- Review mode: read-only implementation review. I did not use the browser because the parent task said the browser was in use.
- Notepad path: not provided.

## Evidence Inspected

- Reference inventory: `/Users/user01/Desktop/NAEO/reverse-engineering/page.md`.
- Route/data coverage: `src/data/page-index.json`, `src/data/pages/*.json`.
- Rendering implementation: `src/components/captured/NodeRenderer.tsx`, `src/components/captured/CapturedView.tsx`, `src/components/captured/SharedDialogs.tsx`, `src/components/PageExperience.tsx`, `src/components/StatefulExperience.tsx`.
- Route handling: `src/app/page.tsx`, `src/app/[...segments]/page.tsx`, `src/lib/pages.ts`.
- Behavior adapters: `src/behaviors/*.tsx`.
- Asset evidence: `docs/research/naeo.kr/assets.json`, `docs/research/naeo.kr/assets-download.json`, `public/assets/*`.
- Visual evidence: `docs/design-references/naeo.kr/*.png`, `docs/design-references/clone-pricing-1440.png`, `docs/design-references/clone-write-1440.png`.
- Validation command: `npm run typecheck` passed.

## CRITICAL

None found. I did not find evidence that the clone is a pasted screenshot or raster background standing in for the page. The core path renders captured DOM nodes through `NodeRenderer` and injects captured CSS through `CapturedView`, so the main UI is live DOM rather than a static bitmap.

## HIGH

1. Clone screenshots include a visible Next.js dev overlay, which is a user-visible artifact absent from the reference. Both `docs/design-references/clone-pricing-1440.png` and `docs/design-references/clone-write-1440.png` show a red `1 Issue` badge in the bottom-left corner. This blocks visual approval because the clone evidence itself contains an extra UI element and indicates an unresolved runtime/dev warning. Re-capture from a clean production build or fix the underlying issue before approval.

2. `/dashboard/recommendations` filter behavior is wrong for the main opportunity cards. In `src/behaviors/recommendations.tsx:116`, the filtered list is computed as `filter !== "opportunity" && ...`, so selecting the `선점기회` card always empties the table. The `황금 키워드` state is set at `src/behaviors/recommendations.tsx:249`-`253`, but `filter === "golden"` is never used to narrow records, so that filter keeps showing the period list instead of the golden subset. This is an actionable interaction bug on a required dashboard page.

3. Visual QA evidence is incomplete for an all-pages clone. The route index contains 61 renderable routes, but I found only two clone comparison PNGs: `docs/design-references/clone-pricing-1440.png` and `docs/design-references/clone-write-1440.png`. The reference PNG set also has no named screenshots for 28 renderable routes, including all 20 blog detail pages plus `/event`, `/event/naeo-review`, `/event/ranking-reward`, `/privacy`, `/privacy/extension`, `/ranking`, `/refund`, and `/terms`. Without clean clone screenshots across the route families and mobile/tablet breakpoints, visual fidelity for the full request is not reviewable.

## MEDIUM

1. Five image references in `/blog/guide/dashboard-guide` point to local assets that were never downloaded. `docs/research/naeo.kr/assets.json:239`-`256` maps these URLs to local `/assets/*.webp` paths, while `docs/research/naeo.kr/assets-download.json:357`-`402` records HTTP 404 failures. The renderer will keep the image boxes and alt text, but those sections will not visually match a complete article if the original assets become available or were expected in the clone.

2. The cloned page tree uses live DOM, but added adapter UI is not consistently token-driven. Examples include hardcoded colors and one-off dimensions in `src/components/captured/captured.css:5`, `src/components/captured/captured.css:14`-`15`, `src/behaviors/landing.tsx:88`-`96`, and `src/behaviors/recommendations.tsx:181`-`201`. This does not make the clone fake, but the added dialogs/detail panels should use the shared `--primary`, `--surface`, `--border`, and spacing primitives more consistently.

3. Many referenced image assets are stored and referenced with `.bin` extensions even when the file content is JPEG/GIF. I counted 225 `.bin` asset references from page data. This may still decode in browsers, but it should be verified in a production server because static MIME handling can affect rendering.

## LOW

1. The worktree is not a clean review snapshot. There are many untracked captured data, screenshots, scripts, and public assets, plus modified tracked files. That is acceptable for in-progress work, but final approval should be based on a committed or otherwise frozen source state.

2. I found no test files under `tests/`; `package.json` has a `test` script, but `rg` reported no `tests` directory. `npm run typecheck` passed, which is useful, but interaction regressions like the recommendation filter bug need a small DOM-level or browser-level check.

## Positive Findings

- The main renderer is a real component path: `PageExperience` selects page adapters, `CapturedView` injects page CSS, and `NodeRenderer` recursively emits DOM elements from captured JSON.
- The renderer blocks active script/iframe-style execution and strips unsafe URL schemes in `src/components/captured/NodeRenderer.tsx:6`-`7`, `src/components/captured/NodeRenderer.tsx:66`-`78`, and `src/components/captured/NodeRenderer.tsx:94`-`115`.
- `src/data/page-index.json` covers 61 renderable routes and all indexed JSON files exist with non-empty body and CSS data.
- `npm run typecheck` passed.

## Blockers Before Approval

- Remove the dev overlay/runtime issue from clone screenshots and provide clean evidence.
- Fix `/dashboard/recommendations` golden/opportunity filters.
- Provide enough clean visual QA artifacts to review the full 61-screen clone scope, including mobile/tablet coverage for representative route families.
