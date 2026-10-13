# CapturedView / NodeRenderer / SharedInteractions

## Overview
- Target: src/components/captured/{CapturedView,NodeRenderer,SharedDialogs}.tsx and captured.css only.
- Reference: docs/design-references/naeo.kr/pricing-desktop.png; runtime-dashboard-1440.png.
- Interaction: actual DOM React rendering; click driven accordion/navigation/forms; scroll driven header; native media.
- Do not render screenshot images as page content; do not execute original site JS or contact its APIs.

## Structure and exact styles
- Input CapturedPageData from src/types/site.ts: body contains real tag/attrs/children, css contains original Emotion declarations. Render the structured tree recursively with React.createElement; retain classes, layout, inline SVGs, text, responsive rules and inline style.
- Body computed: Pretendard,16px,400,25.6px,#e0e0e0,background #121212. Public H3 pricing 44.8px/900. Main dashboard H1 24.8px/900/31px. All per-element exact style rules already encoded in page.css and attrs.style; do not substitute spacing/typography.
- Existing globals.css is foundation; captured CSS must follow it in cascade. Original styles contain desktop/tablet/mobile breakpoints 600/900/1200/1536px.
- Avoid unsafe attributes, scripts, iframe, event attributes. Convert class→className, for→htmlFor, SVG attributes, styles→React.CSSProperties; preserve boolean attrs. Inputs use defaultValue/defaultChecked. No handlers warning. Source videos remain real <video>.
- Links already normalized to local /paths. External meaningful public links may remain; no original auth/API navigation or tracking.

## Contract
- export default CapturedView({data, install?}:{data:CapturedPageData;install?:InstallBehavior}); InstallBehavior from @/lib/behavior returns cleanup.
- export NodeRenderer({nodes}:{nodes:CapturedNode[]}) from NodeRenderer.tsx, named export; no data loading client side.
- BehaviorTools toast, navigate, openAuth, openDialog(title, ReactNode), closeDialog available to optional adapter. own root ref. Optional adapter installed after render, cleanup on unmount.
- An optional custom adapter marks handled events using event.preventDefault(); generic handlers should respect defaultPrevented and not intercept adapters.

## Shared interaction states
- Accordion buttons aria-expanded: toggle enclosing .MuiAccordion-root / .MuiCollapse-root between hidden height0 and visible height:auto; icon wrapper rotation 180deg; 250ms ease. Preserve original DOM answer content.
- Header scroll: exact rule from saved raw CSS; preserve fixed top, blur16, z100. No invented sticky behavior beyond original source classes.
- Theme: button[aria-label="테마 전환"] toggles root class dark/light and persists naeo-clone:theme. Use palette replacement on data.css for light only when dark data has no light variants (#121212→#fff, #e0e0e0→#111827,#a3a3a3→#6b7280,#1a1a1a→#f7f9fa). Clearly document this fallback in report; default dark must stay unchanged.
- Public mobile menu: button[aria-label="메뉴 열기"] opens local nav using exact labels AI 글쓰기/랭킹/네이버 메이트/이벤트/매거진/요금제. Close restores body scrolling; keyboard Escape closes.
- Auth CTA (시작하기/무료로 시작하기 etc) opens modal, local demo sign-in takes /dashboard. Never collect passwords or call real auth. Dialog layout follows existing panel, radius16, buttons radius8, green #03c75a.
- Copy buttons: copy associated code/pre/URL; show copied state. No original service posts.
- Banner close: remove only banner nearest role=status (not page).
- No generic event should turn all buttons into no-op toast. Leave page-specific buttons for provided adapter.

## Assets and content
- All nodes use downloaded /assets/... files and /fonts/pretendard.woff2. Real inline SVG remains in tree.
- Text verbatim comes from data; no rewriting public page copy. Session-specific username becomes NAEO 블로거 during import (parent owns import).
- Missing original images must have visible alt graceful fallback, never blank broken layout.

## Responsive
- Exact extracted CSS controls 1440/768/390. Wrapper must not add width, margin or overflow.
- Dialog max-width440, viewport minus32; mobile nav full-height, 280px/max85vw. These overlay fallback dimensions are reconstruction choices because not yet observed.

## Verification
- npx tsc --noEmit required. Own only listed component folder. Parent owns routes/data/globals. No worktree reset/revert of others.
