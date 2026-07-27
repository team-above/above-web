# 02. 템플릿 리스트 (홈)

- 상태: **Implemented** (2026-07-27 — 수용 기준 5종 전부 테스트로 확인)
- 관련: PRD §4(범위)·§6, 선행: [스펙 01](01-template-schema.md) (Reviewed)

## 배경 / 목적

홈은 제품의 첫 화면이자 유일한 탐색 화면이다. 템플릿을 카드로 훑고 → 하나를 골라 에디터로
진입하는 것 외의 기능은 두지 않는다. 참고 시안(replit)의 구조를 따른다.

## 요구사항

**필수**

1. 상단 헤더에 브랜드 로고(above. 워드마크) 표시
2. "Frame templates" 타이틀 + 우측에 템플릿 수("6 frames") 표시
3. 템플릿 카드 세로 리스트 — `order` 오름차순, 템플릿 JSON에서 로드 (하드코딩 금지)
4. 카드 구성: 미리보기 이미지(Post 4:5 비율) + 하단 바(템플릿 이름 좌측, "Post"·"Story" 배지 우측)
5. 카드 탭 → `/editor/[frameId]` 이동 (에디터는 스펙 03 전까지 준비 중 화면)
6. 템플릿 JSON은 로드 시 `validateTemplate` 검증을 거친다 — 스펙 01 수용 기준 5의 실배선

**제외**

- 검색/필터/정렬 UI, 비율별 진입 분기(배지는 표기용), 무한 스크롤 (6종 고정)

## 미리보기 에셋 규약

- 카드 미리보기 = **사용 예시 시안(SampleNN.png)** — 사진이 채워진 완성 예시가 빈 프레임보다
  템플릿의 매력을 잘 전달한다 (참고 시안과 동일한 접근)
- 파생 스크립트 확장: `SampleNN.png`(2160×2700) → ¼ 축소(540×675) → `public/frames/frameNN/preview.png`
- 카드에서 `next/image`로 로드, 첫 화면 카드에만 `priority`

## UX 플로우

1. 진입 → 헤더(로고) + 타이틀 + 카드 6장 (모바일 1열, max-w-135 중앙 컬럼)
2. 카드 탭 → `/editor/[frameId]` 라우팅 (Vercel Analytics가 라우트 페이지뷰로 템플릿별 관심 집계)
3. 에디터 준비 중 화면: 템플릿 이름 + "준비 중" 안내 + 홈으로 돌아가기 (스펙 03에서 교체)

## 구현 노트

- `src/templates/index.ts`: 템플릿 JSON 6개를 정적 import → `validateTemplate` 통과시켜
  `templates: FrameTemplate[]` (order 정렬) 제공. 검증 실패는 빌드/로드 시점에 throw
- 카드는 `src/features/home/TemplateCard.tsx` — 홈 전용 컴포넌트로 features에 배치
- 서버 컴포넌트로 충분 (인터랙션은 링크뿐)

## 엣지 케이스

- 템플릿 JSON 검증 실패 → 명시적 에러 (조용히 빈 리스트 금지)
- 존재하지 않는 frameId로 `/editor/x` 접근 → 404 (`notFound()`)
- 미리보기 이미지 로드 실패 → alt 텍스트(템플릿 이름) 노출

## 수용 기준 (Acceptance Criteria)

1. 홈에 6개 카드가 order 순으로 렌더되고, 각 카드에 이름·Post/Story 배지·미리보기가 보인다
2. 카드 탭 시 해당 `/editor/[frameId]`로 이동한다 (6종 전부)
3. 존재하지 않는 frameId는 404를 반환한다
4. 템플릿 로더가 검증 실패 JSON을 만나면 명시적 에러를 던진다 (단위 테스트)
5. 모바일(375px)과 데스크톱(1280px)에서 레이아웃이 깨지지 않는다 (중앙 고정 컬럼)

## 테스트 계획

- 단위: 템플릿 로더(정렬·검증 배선), TemplateCard 렌더(이름/배지/링크 href)
- E2E: 홈 → 카드 6장 확인 → 첫 카드 탭 → `/editor/frame01` 도착, 미존재 frameId 404,
  모바일·데스크톱 프로젝트 양쪽 실행 (기존 Playwright 설정 활용)
