# /editor/[frameId] (에디터)

현재: 준비 중 플레이스홀더. 본 구현은 docs/specs/03-editor.md (미작성) 승인 후.

- frameId는 `getTemplate()`으로 검증, 미존재 시 `notFound()`
- 이 라우트의 페이지뷰가 "템플릿별 편집 사용" 지표다 (PRD §2) — 라우트 구조 바꿀 때 주의
- 에디터 구현 시: Konva 씬 그래프로 미리보기=내보내기 동일 렌더 (AGENTS.md 원칙),
  다운로드 완료는 `/editor/[frameId]/done` 라우트로 집계 예정
