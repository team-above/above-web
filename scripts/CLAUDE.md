# scripts/ (파생 파이프라인)

규약·렌더 모델: docs/specs/01-template-schema.md — **이 문서를 읽고 작업 시작**

- `derive-frames.ts`: 디자이너 v2 시안(`docs/design/frames/<프레임명>/`) →
  `src/templates/<id>.json` + `public/frames/<id>/` 파생. 순수 픽셀 로직은
  `src/lib/frame-derive.ts`(단위 테스트 대상), 파일 IO·프레임 설정은 스크립트 담당
- 새 프레임 추가 = `FRAME_CONFIGS`에 항목 추가 + 실행. 슬롯 id는 읽기 순서(위→아래,
  왼→오른쪽) 매핑. 디자인이 선명한 단색을 쓰면 `slotLayer` 명시 필요(모호하면 에러가 알려줌)
- **자동 회귀 내장**: 파생마다 base+회색 자리표시+overlay 합성을 sample_gray와 비교
  (불일치 0.5% 초과 시 에러). 통과 로그의 불일치율을 보고에 포함할 것
- 모호한 시안(레이어 후보 2장, 색 수 불일치, 비정수 배율)은 **추측하지 말고 에러로 멈춘다** —
  설정 명시나 디자이너 확인으로 해소
