---
name: add-frame
description: 디자이너 v2 시안 폴더를 받아 프레임 한 종을 이행/추가하는 전 과정 — 시안 검증 → 파생 설정 → 파생 실행 → 테스트 → 브라우저 검증 → 보고. 사용법 /add-frame <프레임명(폴더명)>
---

# 프레임 이행/추가 절차

한 번에 **한 프레임만** 처리한다 (검토 가능한 작업 단위 — 사용자 확정 2026-08-07).
규약·용어는 docs/specs/01-template-schema.md와 AGENTS.md 용어집을 따른다.

## 0. 선행 확인

- `docs/design/frames/<프레임명>/` 폴더 존재 확인. 없으면 중단하고 사용자에게 알림
- 대상 프레임의 슬롯 수·의미가 스펙 01 매핑 표와 다르면(신규 디자인·슬롯 변경)
  **파생 전에 사용자에게 해석을 확인**받는다 — 추측 금지

## 1. 시안 검증 (파생 전 분석)

sharp/pngjs 스크립트로 다음을 확인하고 결과를 수치로 기록:

1. 파일 목록이 규약과 맞는가 — `<프레임명>_<변형>_layerNN.png`, `_sample_gray.png`,
   `<프레임명>_sample.png`. **명명 편차는 임의 해석 금지** — 파일을 열어 내용을 확인하고
   사용자에게 보고 후 설정 오버라이드(sampleName/sampleGrayName)로 처리
2. 규격: 모든 파일 같은 크기, 가로폭 = 1080의 정수배, post 4:5 / story 9:16
3. `extractSlotRegions`로 각 레이어의 채움 분석 — 슬롯 레이어가 어느 장인지, 색·bbox·채움비.
   **여러 레이어에서 채움이 검출되면**(디자인 자체가 선명한 단색 사용) 슬롯 레이어를 눈으로
   판별해 `slotLayer`에 명시할 근거를 기록

## 2. 파생 설정 + 실행

1. `scripts/derive-frames.ts`의 `FRAME_CONFIGS`에 항목 추가:
   - id = 프레임명 소문자 슬러그, name = 디자이너가 준 이름, order = 라인업 순서
   - slots = 읽기 순서(위→아래, 왼→오른쪽)대로 id·한국어 label
   - 필요 시 slotLayer / sampleName / sampleGrayName
2. `node scripts/derive-frames.ts` 실행 — **합성 자동 회귀 통과 필수** (불일치율을 보고에 포함).
   실패하면 diff 시각화로 원인을 파악하고, 시안 문제면 사용자를 통해 디자이너에게 전달
3. 생성된 `src/templates/<id>.json`의 placement(rect/radius/mask 분류)가 시안과 맞는지 확인

## 3. 코드 연결 (신규 프레임일 때만)

- `src/templates/index.ts`에 import 한 줄 추가
- 기존 v1 프레임 교체라면: 슬롯 id가 바뀌었는지 확인하고 E2E에서 옛 슬롯 id 참조를 갱신
  (`grep -n "<id>" e2e/*.spec.ts`)
- 시각 회귀 대상(`e2e/visual.spec.ts` TEMPLATE_IDS)·홈 카드 수(`e2e/home.spec.ts`) 갱신 여부 확인

## 4. 검증 (전부 통과해야 완료)

1. `npm test && npm run typecheck && npm run lint`
2. `npm run e2e` — **:3000 dev 서버 먼저 종료** (`.next` 락 충돌)
3. 브라우저 확인 (프리뷰 서버): `/editor/<id>`에서
   - 빈 상태가 시안과 같은가 (자리표시·배경)
   - 각 슬롯에 사진 첨부 → 층 순서(오버레이가 사진 위) 확인
   - **투명 배경 PNG 첨부** → 투명 영역으로 프레임 배경이 비치는가
   - Post↔Story 전환 → 사진·초점 유지
   - 홈 카드 미리보기 갱신 확인

## 5. 마무리

- 스펙 01의 매핑 표·구현 현황 갱신 (해당 프레임 ✅, 특이사항 기록)
- 결과 보고: 추출 좌표·회귀 불일치율·테스트 결과·스크린샷. **커밋은 사용자 승인 후**
