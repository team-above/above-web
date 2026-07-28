# 03. 에디터 (슬롯 · 사진 조작 · 비율 전환)

- 상태: **Implemented** (2026-07-28)
- ⚠ 조작 모델 일부는 [스펙 06](06-selection.md)이 대체 (2026-07-28): 탭=교체 폐지(탭=선택
  토글, 교체는 선택 후 📷), 드래그·줌은 선택 상태에서만. 편집 상태(위치 초점·줌·회전)는
  전부 사진 속성으로 비율 간 공유 — 이 스펙의 "비율별 독립 조정"(AC5)은 폐기
- 구현 노트 (스펙과의 편차·검증 방식):
  - 시각 회귀(AC1)는 golden 스크린샷 대신 **브라우저 내 base+overlay 재합성과의 픽셀 비교**
    (4px 샘플링, 허용치 3% — frame05 낙서 같은 고대비 스트로크의 서브픽셀 보간 차이 흡수)
  - 층 순서(AC2)는 frame02(별)·frame04(라벨)·frame05(낙서) 사진 첨부 상태를 E2E 픽셀 프로브로 검증
  - 제스처는 포인터 이벤트 + 윈도우 세션(캡처 의미론) — 시작한 슬롯이 끝까지 소유, 이웃 슬롯
    오탭 방지 E2E 포함. objectURL은 사용하지 않음(File→ImageBitmap 직행이 더 안전)
  - 빈 슬롯 + 배지는 별도 UI Layer(둘째 canvas) — 내보내기·시각 비교에서 자연 격리
  - 콘솔 에러 0(AC6): 에디터 플로우 E2E 전 테스트에서 단언. 404 라우트의 pageerror는 **Next dev
    오버레이 한정**(프로덕션 빌드에서 미발생 확인, 2026-07-28)
  - transform.ts 100% 커버리지는 vitest 파일별 threshold로 강제
  - 알려진 한계: 구형 iOS Safari의 createImageBitmap 옵션 미지원 가능성(모던 브라우저 타깃),
    사진 비트맵은 슬롯 교체·템플릿 이탈 시 close()로 반환
- 관련: PRD §4, 선행: [스펙 01](01-template-schema.md)(렌더링 모델), [스펙 02](02-template-list.md).
  PNG 다운로드는 [스펙 04](04-export.md)에서 분리해 다룬다 (다운로드 버튼 자리만 이 스펙에 포함)

## 배경 / 목적

제품의 코어 화면. "슬롯 탭 → 사진 넣기 → 위치 조정 → (다운로드)"가 마찰 없이 끝나야 한다.
스펙 01의 3층 렌더링 모델을 Konva 씬으로 실체화하며, **미리보기 씬이 곧 내보내기 씬**이다.

## 화면 구조

```
헤더:  [< Home]        템플릿 이름         [다운로드 아이콘(스펙 04)]
비율:  [ Post 4:5 | Story 9:16 ]  세그먼트 토글
캔버스: Konva Stage — 뷰포트에 fit (src/lib/canvas-size.ts fitToViewport)
하단:  힌트 텍스트 "슬롯을 탭해서 사진을 넣어 보세요"
```

- 라우트: `/editor/[frameId]` (기존 준비 중 화면 교체). Konva는 클라이언트 컴포넌트로 동적 로드(ssr: false)
- 모바일 퍼스트: 캔버스가 화면 폭에 fit, 데스크톱은 중앙 컬럼 유지

## Konva 씬 구조 (z-순서, 스펙 01 렌더링 모델의 실체화)

```
Stage (canvas 좌표계 = 1080×1350 / 1080×1920, 뷰포트 스케일은 Stage scale로만)
└ Layer
   ├ [1] base Image        — base.png
   ├ [2] placement Group × N (listening: 슬롯 탭 히트 영역)
   │      ├ photo Image    — 사용자 사진 (cover + transform 적용)
   │      └ mask Image     — mask-<slot>.png, globalCompositeOperation: "destination-in"
   ├ [3] overlay Image     — overlay.png (listening: false)
   └ [UI] 빈 슬롯 플레이스홀더(+ 아이콘·탭 안내) — 내보내기 시 숨김 (스펙 04)
```

- placement Group은 Konva `cache()`로 마스크 합성을 격리한다 (사진·마스크만 묶어 destination-in)
- overlay는 히트 테스트를 막지 않도록 listening: false — 슬롯 탭은 placement 영역이 받는다

## 사진 첨부 플로우

1. 빈 슬롯 탭 → hidden `<input type="file" accept="image/*">` 트리거
2. 선택한 파일 → `createImageBitmap(file, { imageOrientation: "from-image" })` (EXIF 회전 보정)
   → objectURL 정리까지 슬롯 상태에 저장
3. 초기 배치 = **cover** (placement rect를 빈틈 없이 채우는 최소 스케일, 중앙 정렬)
4. 같은 슬롯을 여러 placement가 참조하는 경우(현 라인업 없음) 동일 사진을 공유한다

## 사진 조작

- **드래그**: 사진 있는 슬롯에서 1-포인터 드래그 → 오프셋 이동
- **핀치 줌**(모바일 2-포인터) / **휠**(데스크톱): 슬롯 중심 기준 스케일 조정
- **클램프**: 스케일 하한 = cover 스케일(빈틈 금지), 상한 = cover의 3배. 오프셋도 rect를 벗어나
  빈틈이 생기지 않도록 매 변경마다 클램프 — 이 계산은 순수 함수(`src/features/editor/transform.ts`)로
  분리해 단위 테스트한다
- 조작 대상은 "사진이 있는 슬롯" 자체 — 별도 선택 상태 없이 슬롯 위에서 바로 제스처

## 비율 전환 (Post ↔ Story)

- 세그먼트 토글로 즉시 전환. **슬롯별 사진은 유지**하고(같은 슬롯 id), 배치 transform은
  비율별 placement가 다르므로 **variant별로 독립 저장** (전환해도 이전 비율의 조정값 보존)
- URL은 유지(쿼리 없음) — 지표는 템플릿 단위 페이지뷰로 충분 (PRD §2)

## 상태 (Zustand — src/stores/editor.ts)

```ts
{
  variant: "post" | "story",
  photos: Record<slotId, { bitmap: ImageBitmap, fileName: string }>,
  transforms: Record<variant, Record<slotId, { x: number, y: number, scale: number }>>,
  setPhoto / setTransform / setVariant / reset(템플릿 진입 시)
}
```

- 서버 저장 없음 — 새로고침 시 초기화 (MVP 범위)

## 엣지 케이스

- 이미지 파일이 아니거나 디코딩 실패 → 안내 토스트, 슬롯 상태 불변
- 대형 사진(수천만 화소) → createImageBitmap 다운샘플(최장변 2160px 상한)로 메모리 보호
- 파일 선택 취소 → 아무 일 없음
- frame02 별무리처럼 마스크가 희소한 슬롯도 placement rect 전체가 탭 히트 영역
- 뷰포트 리사이즈/회전 → Stage 스케일 재계산 (fitToViewport)

## 수용 기준 (Acceptance Criteria)

1. 6종 × 2비율 전부: 사진 없는 초기 화면의 캔버스 렌더가 시안 PNG와 픽셀 수준으로 일치한다
   (**시각 회귀** — Playwright 스크린샷, 스펙 01 AC 3 이월 해소)
2. frame02(별무리 마스크)·frame04(라벨 오버레이)·frame05(낙서 겹침)에 사진을 넣으면 샘플과
   동일한 층 순서로 보인다 (사진 위 장식 유지 — 스펙 01 AC 4 이월 해소)
3. 슬롯 탭 → 파일 선택 → 사진이 cover로 채워진다 (E2E, 파일 첨부 포함)
4. 드래그·줌 후에도 슬롯에 빈틈이 생기지 않는다 (클램프 단위 테스트 + E2E 스팟체크)
5. 비율 전환 시 사진이 유지되고, 각 비율의 조정값이 독립 보존된다
6. 미존재 frameId 404 유지, 콘솔 에러 0
7. transform·cover 계산 순수 함수는 커버리지 100% (에디터 코어 로직)

## 테스트 계획

- 단위: transform 클램프·cover 계산(경계값), editor 스토어(variant 전환·사진/조정값 보존), 비트맵
  다운샘플 결정 로직
- E2E: 사진 첨부 플로우(`setInputFiles`), 비율 전환 유지, 시각 회귀 스크린샷 12변형(빈 상태)
  - frame01 사진 첨부 상태 1종

## 사용자 확인 결과 (2026-07-27)

1. **사진 있는 슬롯 재탭 = 바로 파일 선택 열려 교체** (A안). 제거 기능 없음 — 교체로 충분
2. **줌 상한 = cover×3 유지** — 결과물 화질 가드레일. 추후 피드백 보고 상수만 조정

## 추가 확정 (2026-07-28)

- **조작 중 고스트**: 드래그/핀치/휠 조작 중에는 사진 전체를 35% 투명도로 UI 레이어에 겹쳐
  보여준다 — 슬롯 밖으로 잘리는 영역을 보며 편집. 조작이 끝나면(휠은 500ms 유휴 후) 사라지고,
  내보내기·시각 회귀에는 포함되지 않는다
- **상태 초기화 정책**: 에디터를 떠나 홈으로 돌아가면 편집 상태를 전부 초기화한다(처음부터 시작).
  에디터↔done 왕복(계속 편집)은 홈을 거치지 않으므로 유지된다 (스펙 04 AC4와 양립)
- (구현 노트) 홈 카드 미리보기는 파생 해상도 1080w + `unoptimized` — Next dev 이미지 최적화기가
  WebP 업스케일 요청에 응답하지 않는 문제 회피 겸, 자체 파생 에셋이라 재최적화 불필요

## 변경 (2026-07-28, 2차)

- **드래그 누적 버그 수정**: 제스처 윈도우 리스너가 세션 시작 시점의 transform 클로저를 참조해
  이동이 누적되지 않던 문제 — 스토어에서 최신 상태를 읽도록 수정. E2E에 "실제 이동" 색상 검증
  추가 (2색 픽스처)
- **줌 상한 제거** (기획 확정): cover×3 상한 폐지, 확대 무제한. 하한(cover, 빈틈 금지)은 유지
