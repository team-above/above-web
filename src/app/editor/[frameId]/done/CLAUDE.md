# /editor/[frameId]/done (다운로드 완료)

스펙: docs/specs/04-export.md (Implemented)

- **이 라우트의 페이지뷰 = 다운로드 집계 = 전환율(1차 지표)의 분자다** (PRD §2).
  라우트 경로를 바꾸면 지표가 끊긴다
- 집계 오염 방지: `DonePanel`이 다운로드를 거치지 않은 접근(직접 URL·새로고침)을
  에디터로 리다이렉트 — 가드 조건은 templateId 일치 + 사진 존재 + exportUrl 존재
- 미리보기 = 스토어의 내보내기 blob objectURL (revoke는 스토어가 관리).
  인앱 브라우저 저장 실패 대비 "길게 눌러 저장" 보조 안내 포함
