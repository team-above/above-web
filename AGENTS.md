<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# above

사진에 프레임 템플릿을 씌워 인스타그램용 이미지(Post 4:5 / Story 9:16)로 내보내는 모바일 웹 앱.
MVP 단계 — 백엔드 없음, 모든 처리는 클라이언트에서 완결된다.

## 명령어

```bash
npm run dev            # 개발 서버 (Turbopack, :3000)
npm run build          # 프로덕션 빌드
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm test               # Vitest 단위 테스트 (1회 실행)
npm run test:watch     # Vitest watch
npm run test:coverage  # 커버리지 (80% 강제)
npm run e2e            # Playwright E2E (dev 서버 자동 기동, :3897)
node scripts/derive-frames.ts  # 시안 → 템플릿 JSON + 에셋 파생 (자동 회귀 포함)
```

같은 게이트가 3중으로 강제된다: 프리커밋 훅(`.githooks/`) → CI(`.github/workflows/ci.yml`,
main 푸시·PR마다 + 프로덕션 빌드) → Vercel 배포. E2E 실행 전 :3000 dev 서버를 끌 것
(`.next` 락 충돌).

## 스택

- Next.js 16 (App Router) + TypeScript, 백엔드 없음
- Tailwind CSS v4 — 토큰은 `globals.css`의 `@theme`에 정의
- react-konva — 에디터 캔버스. **미리보기와 PNG 내보내기는 반드시 같은 Konva 씬 그래프를 사용한다** (화면과 결과물이 달라지는 것 방지)
- Zustand — 에디터 상태 (선택 템플릿, 슬롯별 사진, 변환값)

## 구조

```
src/
  app/          # 라우트 (홈 = 템플릿 리스트, editor/[frameId] = 에디터)
  components/   # 공용 UI 컴포넌트
  features/     # 도메인 기능 (editor 등) — UI + 로직 + 테스트 코로케이션
  lib/          # 순수 유틸 (canvas-size, frame-derive 등)
  stores/       # Zustand 스토어
  templates/    # 프레임 템플릿 JSON + 스키마 타입 — 파생 산출물, 손으로 수정 금지
public/frames/  # 프레임 런타임 에셋 (base/overlay/preview.webp, mask) — 파생 산출물
scripts/        # derive-frames.ts — 디자이너 시안 → 산출물 파생 파이프라인 (스펙 01)
docs/design/frames/<프레임명>/  # 디자이너 전달 원본 (v2 레이어 시안)
e2e/            # Playwright 테스트 (editor 플로우·visual 시각 회귀·export·home)
```

## 용어집 (사람·AI·디자이너 공통 언어 — 대화·코드·스펙에서 이 뜻으로만 쓴다)

| 용어                  | 뜻                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------- |
| 프레임(=템플릿)       | 사용자가 고르는 디자인 한 종. id = 디자이너가 준 이름의 소문자 슬러그 (duo, accent, …) |
| 변형(variant)         | 한 프레임의 비율 버전 — post(1080×1350) / story(1080×1920)                             |
| 슬롯(=칸, 구멍)       | 사진 1장이 들어가는 단위. 탭 대상                                                      |
| placement             | 슬롯 사진이 실제로 그려지는 영역 정의 — rect(+radius 또는 mask)                        |
| 레이어(layerNN)       | 디자이너 전달 원본의 층. NN 오름차순 = 아래→위                                         |
| 슬롯 레이어           | 슬롯 위치를 **선명한 단색 채움**으로 선언하는 레이어 (프레임당 정확히 1장)             |
| 채움(fill)            | 슬롯 레이어의 단색 영역. 좌표 마커일 뿐 그림이 아니다 — 파생 시 파냄                   |
| 크롬(chrome)          | 슬롯 레이어에서 채움을 뺀 나머지(테두리·그림자) — 사진 위에 얹힘                       |
| base                  | 슬롯 레이어 **아래층들** 합성 산출물(webp). 회색을 굽지 않는다                         |
| overlay               | 크롬 + 슬롯 레이어 **위층들** 합성 산출물(webp). 항상 사진 위에 그려짐                 |
| 자리표시(placeholder) | 빈 슬롯에 **코드가** 그리는 회색(#D9D9D9). 사진이 오면 사라짐                          |
| sample                | 사진이 든 사용 예시 시안 → 홈 카드 preview.webp의 원본                                 |
| sample_gray           | 빈 상태 완성본 시안 — 파생 자동 회귀의 QA 기준 (런타임에서 안 씀)                      |
| 파생(derive)          | 시안 → 런타임 에셋+JSON 변환. `scripts/derive-frames.ts`                               |
| 배율(factor)          | 시안 가로폭 ÷ 1080 (정수 강제)                                                         |
| 캔버스 좌표계         | 1080폭 기준 좌표 — placement rect·radius의 단위. 내보내기 PNG는 2배 래스터(2160폭)     |
| 초점(focal)           | 슬롯 중심에 오는 사진 픽셀 좌표. 줌·회전과 함께 **비율 간 공유**                       |
| 고스트                | 슬롯 선택 시 슬롯 밖까지 35% 투명도로 보여주는 사진 전체 미리보기                      |
| v1 / v2               | 구(크로마키 통짜 PNG) / 현(레이어 분리 시안) 파생 규약 — 스펙 01                       |

## 핵심 원칙

- **템플릿은 데이터다**: 프레임은 `src/templates/`의 JSON(+에셋)으로 정의한다. 새 템플릿 추가에 컴포넌트 코드를 만들지 않는다.
- **산출물은 파생으로만**: `src/templates/*.json`과 `public/frames/`는 `scripts/derive-frames.ts`가 생성한다. 손으로 수정하지 말고, 시안(`docs/design/frames/`)이나 파생 스크립트를 고쳐 재파생한다.
- **내보내기 규격**: 좌표계 Post 1080×1350 / Story 1080×1920, PNG는 2배 래스터 2160×2700 / 2160×3840 (`src/lib/canvas-size.ts`). 미리보기는 좌표계를 스케일만 해서 보여준다.
- **모바일 퍼스트**: 주 타깃은 모바일 브라우저. 데스크톱은 중앙 고정 컬럼(max-w-135).
- **테스트**: 기능 구현 후 단위 테스트 필수, 커버리지 80% 강제. 캔버스 시각 결과는 Playwright 스크린샷 회귀로 검증.
- 라우트 폴더마다 해당 화면의 맥락을 담은 CLAUDE.md를 둔다.

## 컨벤션

- 함수/변수 영어, 사용자 노출 문구·주석·테스트 설명은 한국어
- import 경로는 `@/` 별칭 사용
- 커밋 메시지에 Co-Authored-By 트레일러 넣지 않는다

## 작업 워크플로 (모든 작업에서 필수)

1. **모호하면 질문한다**: 요구사항·스펙 해석이 갈리거나 판단이 필요한 지점은 넘겨짚지 말고 사용자에게 질문해 정보를 받아낸다. (편집 실행 허락을 묻는 것과는 별개 — 실행 확인은 묻지 않는다)
2. **스펙 우선**: 제품 방향은 `docs/prd.md`, 기능 상세는 `docs/specs/`가 기준이다. 새 기능/화면은 코드 전에 스펙을 작성해 사용자 리뷰(상태 Reviewed)를 받은 뒤 구현하고, 구현 세션은 해당 스펙과 PRD를 읽고 시작한다. 스펙 본문은 **현재 상태 중심**으로 유지한다 — 결정의 경위·이력은 문서 하단 "변경 이력"과 git에 두고, 본문에 과거 상태를 남기지 않는다.
3. **분해 검토**: UI 코드를 만들거나 수정한 작업이 끝나면 매번 `ui-decomposer` 에이전트를 호출해 디자인 토큰·컴포넌트 분해 가능성을 검토하고, 기준 충족 시 추출까지 수행한다. 불필요한 쪼개기(투기적 추상화, 억지 일반화)는 금지.
4. **자가검토 최소 2회 + 테스트 검증**: 완료 보고 전에 반드시 —
   - 1차: 사용자의 요구사항 목록과 `git diff`를 직접 대조하고, UI 변경이면 브라우저 스크린샷으로 실물을 확인한다.
   - 2차: `self-reviewer` 에이전트에 요구사항 목록과 검토 범위를 넘겨 독립 검증을 받는다.
   - 테스트: `npm run lint && npm run typecheck && npm test` 통과를 직접 확인한다 (UI 플로우 변경 시 `npm run e2e` 포함). 실패 상태로 완료 보고 금지.
5. **커밋 규칙**: 커밋 메시지에 Claude를 기여자로 남기지 않는다 — Co-Authored-By/"Generated with Claude Code" 금지 (`.githooks/commit-msg`가 강제). `--no-verify`로 훅을 우회하지 않는다 (Claude Code 훅이 차단).
