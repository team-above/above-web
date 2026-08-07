# /editor/[frameId] (에디터)

스펙: docs/specs/03-editor.md + 04-export.md + 06-selection.md (모두 Implemented).
EditorShell이 헤더 포함 전체 UI 담당, 다운로드 완료 집계는 done/ 하위 라우트.

- frameId = 템플릿 id(디자인 이름 슬러그: duo, accent, …). `getTemplate()`으로 검증, 미존재 시 `notFound()`
- 이 라우트의 페이지뷰가 "템플릿별 편집 사용" 지표다 (PRD §2) — 라우트 구조 바꿀 때 주의
- 렌더링: `@/features/editor/EditorCanvas` — Konva 씬 z-순서(스펙 01):
  base → 자리표시(빈 슬롯, 코드가 회색 rect+radius로 그림) → 사진(사각/둥근 사각은 rect·radius
  클립, 자유 형상만 마스크 destination-in + 그룹 캐시) → overlay.
  **＋배지·고스트·선택 UI는 별도 Layer** — 첫 canvas는 시각 회귀 비교 대상이므로
  UI 픽셀을 넣지 말 것
- 상태는 `@/stores/editor`. **초점(focal)·줌·회전은 사진 속성으로 비율(post/story) 간 공유**
  (스펙 06). 배치 수학은 `@/features/editor/transform.ts` — 순수 함수, 커버리지 100% 강제
- 조작(스펙 06): 탭=선택 토글, 교체는 📷 버튼·삭제는 ✕. 선택 상태에서만 드래그(사진 영역 밖
  포함)·두 손가락 동시 줌+회전. 줌 상한 cover×3. **파일 선택은 반드시 DOM 버튼이 트리거** —
  캔버스 탭이 input을 열면 iOS 파일 메뉴에 캔버스 크기 블롭이 생긴다
- E2E: e2e/editor.spec.ts(플로우·층 순서·클램프·콘솔 에러 0), e2e/visual.spec.ts(빈 상태 =
  base+회색 자리표시+overlay 합성 일치, 전 프레임×2변형)
