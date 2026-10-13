# 페이지 구성

1. 공개 셸: fixed Header → page body sections → Footer. 실제 태그/클래스/스타일을 구조화 데이터로 분리.
2. 홈: Hero → AI 인용 설명 → 검색 방식 비교 → 메이트 → 5가지 기준 → 블로그 진단 → 키워드 → 글쓰기 → 외부 AI → 인용 결과 → 랭킹 → 무료 안내 → CTA.
3. MCP: Hero / mode toggle → 각 mode에 맞는 글쓰기 또는 MCP 안내 → citation tracking → CTA → Footer.
4. Pricing: Heading → 3 plan cards → detailed table → comparison table → FAQ → Footer.
5. Ranking: Header → intro → period tabs → podium → personal summary → topic filters → table → scoring explanation → Footer.
6. Blog: Header → magazine heading/search/category → featured posts → article grid → Footer. 20 detail routes use extracted article DOM.
7. Dashboard: sidebar240px fixed → status banner → profile/credits header → page-specific body. Contents are demo fixtures, shell matches actual inspected page.
8. Admin/auth/utility routes: observe access result; inaccessible administrative internals are not invented as verified clones. Local routes preserve available gate/result and documented fallback.
9. 4 updates legacy URLs redirect to /updates?focus=slug. Four dynamic patterns handled by local route resolver.
