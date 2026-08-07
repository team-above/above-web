# / (홈 — 템플릿 리스트)

스펙: docs/specs/02-template-list.md (Reviewed)

- 템플릿 카드 리스트가 전부다 — 검색/필터/추가 탐색 없음
- 데이터는 `@/templates` 로더에서만 가져온다 (JSON 하드코딩 금지)
- 카드 = `@/features/home/TemplateCard`, 미리보기 = sample 시안 축소본(`preview.webp`)
- 서버 컴포넌트 유지 (인터랙션은 Link뿐)
