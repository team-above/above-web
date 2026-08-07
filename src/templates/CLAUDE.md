# src/templates/ (프레임 템플릿 데이터)

스키마·규약: docs/specs/01-template-schema.md

- `*.json`은 **파생 산출물** — 손으로 수정 금지. 고치려면 시안 또는
  `scripts/derive-frames.ts`를 고쳐 재파생 (public/frames/도 동일)
- id = 디자이너가 준 프레임 이름의 소문자 슬러그 (파일명·에셋 경로·라우트 동일).
  홈 노출 순서는 `order` 필드
- `index.ts`가 로드 시 `schema.ts`로 검증 — 새 템플릿 추가 시 여기 import 한 줄
- placement 형상: rect만(사각) / rect+radius(둥근 사각) / rect+mask(자유 형상).
  radius·mask가 없으면 렌더러가 rect 클립으로 처리
