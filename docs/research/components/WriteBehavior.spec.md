# WriteBehavior
Target: src/behaviors/write.tsx; export installWrite: InstallBehavior.
Scope: /dashboard/write AI 글쓰기 form only. Shared captured React DOM supplied by parent, preserve its layout/classes/content; install event listeners with cleanup.
Interaction: clicks, inputs, local file upload, local mock generation. No scroll-driven switching. No network/server mutations.
Reference: /Users/user01/Desktop/NAEO/naeo-clone/docs/design-references/naeo.kr/dashboard--write-1440.png.
Data: same main project src/data/pages/dashboard--write.json; exact DOM tree, attributes and all CSS are contract.
Original CSS: background #121212; primary #03c75a; Pretendard. sidebar 240px; main margin-left240; title24.8px/900/31px; mobile breakpoint900 removes sidebar, bottom nav.
Form keyword required maxlength60 .mui-c3zido, topic div[role=combobox]+hidden nativeInput required. Textareas experience placeholder 예) 직접 해보니 이런 점이 좋았어요. 겪은 일, 느낀 점, 나만의 팁 한두 줄; maxlength1000. Do not treat hidden measurement textareas as real fields.
Image buttons 1장/3장/5장 values1/3/5, default3 aria-pressed true+Mui-selected; label expected19 tokens initial. Set selected class and aria; 5->25,1->13; reduce by uploaded local images.
Upload input accept image/jpeg,image/png,image/webp multiple max20; actual input/preview objectURLs remove support; no real uploads.
세부 옵션 accordion with existing hidden content handled by shared renderer; don't override it.
Requested instructions textarea and title optional input under accordion. Keyword table rows populate keyword input and event dispatch. 소분류 must have functioning selectable menu (use real topic labels from data/bundles if absent and mark demo source).
Generate button initially disabled; enable only valid keyword+category, show generating then local draft preview and persist via src/lib/demo-store.ts saveDraft. Content explicit demo, include chosen keyword/experience/requested title, not hardcoded success toast. Preview editable text, copy/download, saved drafts link/state supported in tools.openDialog.
Shared contract src/lib/behavior.ts InstallBehavior(root,tools); tools openDialog(title,ReactNode), closeDialog,toast,navigate,openAuth. Use React createRoot only for inserted subcomponents if needed, cleanly unmount.
Use src/lib/demo-store.ts profile/drafts/saveDraft. Do not modify shared store/types: suggest parent changes if needed. Events handled should preventDefault so shared handler skips.
Additional overlays use global naeo-button,naeo-panel,naeo-field styles and tokens. Preserve original initial screenshot. No global CSS edits.
Do not change routing, captured data, renderer or other behaviors. npx tsc --noEmit must pass, commit owned files and report SHA.
