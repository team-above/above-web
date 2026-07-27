# /editor/[frameId] (에디터)

스펙: docs/specs/03-editor.md (Implemented) + 04-export.md (Implemented — 헤더 다운로드 버튼,
EditorShell이 헤더 포함 전체 UI 담당. 완료 화면은 done/ 하위 라우트).

- frameId는 `getTemplate()`으로 검증, 미존재 시 `notFound()`
- 이 라우트의 페이지뷰가 "템플릿별 편집 사용" 지표다 (PRD §2) — 라우트 구조 바꿀 때 주의.
  다운로드 완료는 `/editor/[frameId]/done` 라우트로 집계 예정 (스펙 04)
- 렌더링: `@/features/editor/EditorCanvas` — Konva 3층 씬(base → 사진+마스크 destination-in
  그룹 캐시 → overlay). **UI 배지는 둘째 Layer** — 첫 canvas는 시각 회귀 비교 대상이므로
  UI 픽셀을 넣지 말 것
- 상태는 `@/stores/editor` (사진은 비율 공유, transform은 비율별 독립). 배치 수학은
  `@/features/editor/transform.ts` — 순수 함수, 커버리지 100% 강제
- 제스처: 포인터 세션 기반 (시작 슬롯이 소유). 재탭=교체(A안), 줌 상한 cover×3
- E2E: e2e/editor.spec.ts(플로우·층 순서·클램프·콘솔 에러 0), e2e/visual.spec.ts(시안 일치 12변형)
