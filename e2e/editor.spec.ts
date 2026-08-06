import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const loadTemplate = (id: string) =>
  JSON.parse(
    readFileSync(path.join(__dirname, `../src/templates/${id}.json`), "utf8"),
  );
const frame01 = loadTemplate("frame01");
const frame02 = loadTemplate("frame02");
const frame04 = loadTemplate("frame04");
const FIXTURE = path.join(__dirname, "fixtures/photo-red.png");

/** 콘솔 에러·페이지 에러 수집 — 각 테스트 끝에서 0건을 단언한다 (스펙 03 AC6) */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/**
 * 프레임(템플릿) 좌표 → 페이지 좌표 변환기.
 * 스테이지가 편집 영역 전체를 덮으므로 프레임 원점·배율은 data 속성에서 읽는다 (스펙 06).
 */
async function frameMapper(page: Page) {
  const root = page.locator('[data-testid="editor-canvas"]');
  const canvas = root.locator("canvas").first();
  // 비율 전환 직후엔 에셋을 다시 불러오느라 캔버스가 잠깐 사라진다 — 다시 그려질 때까지 대기
  await expect
    .poll(async () => {
      const b = await canvas.boundingBox().catch(() => null);
      const scale = Number(await root.getAttribute("data-frame-scale"));
      return b && scale > 0 ? 1 : 0;
    })
    .toBe(1);
  const box = (await canvas.boundingBox())!;
  const [left, top, scale] = await Promise.all([
    root.getAttribute("data-frame-left"),
    root.getAttribute("data-frame-top"),
    root.getAttribute("data-frame-scale"),
  ]);
  const s = Number(scale);
  return {
    scale: s,
    stage: box,
    /** 프레임 좌표 → 페이지 좌표 */
    at: (x: number, y: number) => ({
      x: box.x + Number(left) + x * s,
      y: box.y + Number(top) + y * s,
    }),
  };
}

/** 캔버스 표시 좌표계에서 특정 placement 중심의 페이지 좌표를 구한다 */
async function placementCenter(
  page: Page,
  template: ReturnType<typeof loadTemplate>,
  variant: "post" | "story",
  slotId: string,
) {
  const frame = await frameMapper(page);
  const placement = template.variants[variant].placements.find(
    (p: { slot: string }) => p.slot === slotId,
  );
  return frame.at(
    placement.rect.x + placement.rect.width / 2,
    placement.rect.y + placement.rect.height / 2,
  );
}

/** 페이지 좌표 지점의 메인 레이어 캔버스 픽셀 RGB를 읽는다 */
async function pixelAt(page: Page, point: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector(
      '[data-testid="editor-canvas"] canvas',
    ) as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const ratio = canvas.width / box.width; // DPR 무관하게 백킹스토어 좌표로 변환
    const data = canvas
      .getContext("2d")!
      .getImageData(
        Math.round((x - box.left) * ratio),
        Math.round((y - box.top) * ratio),
        1,
        1,
      ).data;
    return { r: data[0], g: data[1], b: data[2] };
  }, point);
}

/** 슬롯 rect 내부의 색상 분포 샘플링 — 층 순서(장식이 사진 위) 검증용 */
async function countSlotColors(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
) {
  return page.evaluate(
    ({ rect }) => {
      // 스테이지가 편집 영역 전체를 덮으므로 프레임 원점·배율을 data 속성에서 읽는다
      const root = document.querySelector(
        '[data-testid="editor-canvas"]',
      ) as HTMLElement;
      const el = root.querySelector("canvas") as HTMLCanvasElement;
      const dpr = el.width / el.clientWidth;
      const scale = Number(root.dataset.frameScale) * dpr;
      const ox = Number(root.dataset.frameLeft) * dpr;
      const oy = Number(root.dataset.frameTop) * dpr;
      const data = el
        .getContext("2d")!
        .getImageData(
          Math.round(ox + rect.x * scale),
          Math.round(oy + rect.y * scale),
          Math.round(rect.width * scale),
          Math.round(rect.height * scale),
        ).data;
      let red = 0;
      let green = 0;
      let blue = 0;
      let white = 0;
      for (let i = 0; i < data.length; i += 16) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (r - g > 80) red++;
        if (g - r > 40) green++;
        if (b - r > 40) blue++;
        if (r > 230 && g > 230 && b > 230) white++;
      }
      return { red, green, blue, white };
    },
    { rect },
  );
}

async function attachPhoto(page: Page, point: { x: number; y: number }) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(point.x, point.y);
  await (await chooserPromise).setFiles(FIXTURE);
}

async function openEditor(page: Page, frameId: string) {
  await page.goto(`/editor/${frameId}`);
  await expect(
    page.locator('[data-testid="editor-canvas"] canvas').first(),
  ).toBeVisible();
}

test("슬롯 탭 → 사진 첨부 → cover로 채워진다", async ({ page }) => {
  const errors = trackErrors(page);
  await openEditor(page, "frame01");

  const center = await placementCenter(page, frame01, "post", "left");
  const before = await pixelAt(page, center);
  expect(before.r - before.g).toBeLessThan(60); // 자리표시(무채색) 상태 — 아직 빨강 아님

  await attachPhoto(page, center);
  await expect
    .poll(async () => {
      const p = await pixelAt(page, center);
      return p.r - p.g; // 빨강 픽스처: r≈220, g≈30
    })
    .toBeGreaterThan(120);
  expect(errors).toEqual([]);
});

test("frame05: 낙서 장식이 사진 위에 남는다 (층 순서)", async ({ page }) => {
  const errors = trackErrors(page);
  await openEditor(page, "frame05");
  const frame05 = loadTemplate("frame05");
  await attachPhoto(page, await placementCenter(page, frame05, "post", "main"));

  const slotRect = frame05.variants.post.placements[0].rect;
  await expect
    .poll(async () => (await countSlotColors(page, slotRect)).red)
    .toBeGreaterThan(1000); // 사진이 슬롯을 채움
  expect((await countSlotColors(page, slotRect)).green).toBeGreaterThan(30); // 낙서가 사진 위에 남음
  expect(errors).toEqual([]);
});

test("frame02: 파란 별 장식이 사진 위에 남는다 (층 순서)", async ({ page }) => {
  const errors = trackErrors(page);
  await openEditor(page, "frame02");
  await attachPhoto(page, await placementCenter(page, frame02, "post", "main"));

  const mainRect = frame02.variants.post.placements.find(
    (p: { slot: string }) => p.slot === "main",
  ).rect;
  await expect
    .poll(async () => (await countSlotColors(page, mainRect)).red)
    .toBeGreaterThan(1000);
  expect((await countSlotColors(page, mainRect)).blue).toBeGreaterThan(100); // 하늘색 별이 사진 위에 남음
  expect(errors).toEqual([]);
});

test("frame04: 요일 라벨이 사진 위에 남는다 (층 순서)", async ({ page }) => {
  const errors = trackErrors(page);
  await openEditor(page, "frame04");
  await attachPhoto(page, await placementCenter(page, frame04, "post", "mon"));

  const monRect = frame04.variants.post.placements.find(
    (p: { slot: string }) => p.slot === "mon",
  ).rect;
  await expect
    .poll(async () => (await countSlotColors(page, monRect)).red)
    .toBeGreaterThan(300);
  // 라벨 텍스트(흰색)가 사진 위에 남음 — 라벨은 슬롯 상단 영역
  const labelArea = { ...monRect, height: Math.round(monRect.height * 0.3) };
  expect((await countSlotColors(page, labelArea)).white).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test("드래그·줌을 끝까지 밀어도 슬롯에 빈틈이 생기지 않는다", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  await attachPhoto(page, center);
  await expect
    .poll(async () => {
      const p = await pixelAt(page, center);
      return p.r - p.g;
    })
    .toBeGreaterThan(120);

  // 오른쪽으로 500px 드래그 (클램프 없으면 왼쪽에 빈틈)
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 500, center.y, { steps: 10 });
  await page.mouse.up();
  // 휠 줌 아웃 최대 시도 (클램프 없으면 cover 아래로 축소되어 빈틈)
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, 3000);

  // 슬롯 왼쪽 가장자리 안쪽 픽셀이 여전히 빨강 (빈틈 = 회색 자리표시 노출이면 실패)
  const frame = await frameMapper(page);
  const { rect } = frame01.variants.post.placements[0];
  const edge = await pixelAt(
    page,
    frame.at(rect.x + 4, rect.y + rect.height / 2),
  );
  expect(edge.r - edge.g).toBeGreaterThan(120);
  expect(errors).toEqual([]);
});

test("드래그로 사진이 실제로 이동한다 (누적 이동)", async ({ page }) => {
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  // 가로로 긴 2색(좌 빨강/우 파랑) 사진 → cover 상태에서도 좌우 이동 범위가 넓다
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(center.x, center.y);
  await (
    await chooserPromise
  ).setFiles(path.join(__dirname, "fixtures/photo-redblue.png"));
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  // 오른쪽 끝까지 드래그 → 사진 왼쪽(빨강)이 슬롯 중앙에 온다
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 300, center.y, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const p = await pixelAt(page, center);
      return p.r - p.b;
    })
    .toBeGreaterThan(100);

  // 왼쪽 끝까지 드래그 → 파랑
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x - 600, center.y, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const p = await pixelAt(page, center);
      return p.b - p.r;
    })
    .toBeGreaterThan(100);
});

/** UI 레이어(둘째 캔버스)의 특정 지점 알파/색 — 고스트 검증용 */
async function ghostAt(page: Page, point: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const layers = document.querySelectorAll(
      '[data-testid="editor-canvas"] canvas',
    );
    const ui = layers[1] as HTMLCanvasElement;
    const b = ui.getBoundingClientRect();
    const ratio = ui.width / b.width;
    const d = ui
      .getContext("2d")!
      .getImageData(
        Math.round((x - b.left) * ratio),
        Math.round((y - b.top) * ratio),
        1,
        1,
      ).data;
    return { r: d[0], a: d[3] };
  }, point);
}

test("선택하면 고스트·테두리가 보이고, 배경 탭으로 해제된다 (스펙 06)", async ({
  page,
}) => {
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(center.x, center.y);
  await (
    await chooserPromise
  ).setFiles(path.join(__dirname, "fixtures/photo-redblue.png"));
  // 슬롯 중앙은 픽스처의 빨강/파랑 경계라 리샘플링에 섞인다 — 경계에서 떨어진 지점으로 판정
  const { rect } = frame01.variants.post.placements[0];
  const frame = await frameMapper(page);
  const insideRed = frame.at(
    rect.x + rect.width * 0.2,
    rect.y + rect.height / 2,
  );
  await expect
    .poll(async () => {
      const p = await pixelAt(page, insideRed);
      return Math.max(p.r, p.b);
    })
    .toBeGreaterThan(150);

  // 첨부 직후 자동 선택 → 슬롯 왼쪽 바깥에 고스트(빨강)가 보인다
  const outside = frame.at(rect.x - 40, rect.y + rect.height / 2);
  await expect
    .poll(async () => (await ghostAt(page, outside)).a)
    .toBeGreaterThan(40);
  expect((await ghostAt(page, outside)).r).toBeGreaterThan(120);

  // 프레임 배경(슬롯 밖 남색 영역) 탭 → 선택 유지 (기획 확정 2026-07-29)
  const bg = frame.at(60, 60);
  await page.mouse.click(bg.x, bg.y);
  await page.waitForTimeout(200);
  expect((await ghostAt(page, outside)).a).toBeGreaterThan(40);

  // 사진 재탭 → 해제, 다시 탭 → 선택 (토글)
  await page.mouse.click(center.x, center.y);
  await expect
    .poll(async () => (await ghostAt(page, outside)).a)
    .toBeLessThan(10);
  await page.mouse.click(center.x, center.y);
  await expect
    .poll(async () => (await ghostAt(page, outside)).a)
    .toBeGreaterThan(40);
});

/**
 * 선택 오버레이 버튼의 화면 좌표 (SelectionControls·ReplaceButton의 배치 로직 재현).
 * 버튼은 프레임이 아니라 스테이지(편집 영역 전체) 안 22px 여백으로 클램프된다.
 */
async function selectionButtons(page: Page, slotIndex = 0) {
  const frame = await frameMapper(page);
  const stage = frame.stage;
  const rect = frame01.variants.post.placements[slotIndex].rect;
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.min(Math.max(p.x, stage.x + 22), stage.x + stage.width - 22),
    y: Math.min(Math.max(p.y, stage.y + 22), stage.y + stage.height - 22),
  });
  const centerX = frame.at(rect.x + rect.width / 2, 0).x;
  return {
    close: clamp(frame.at(rect.x + rect.width, rect.y)),
    camera: clamp({
      x: centerX,
      y: frame.at(0, rect.y + rect.height).y + 32,
    }),
    slotCenterScreen: frame.at(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    ),
  };
}

test("📷로 교체 파일 선택이 열리고, ✕는 사진을 삭제한다 (스펙 06)", async ({
  page,
}) => {
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  await attachPhoto(page, center); // 자동 선택
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  const buttons = await selectionButtons(page);
  // 📷 → 파일 선택 열림 (선택 유지)
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(buttons.camera.x, buttons.camera.y);
  const chooser = await chooserPromise;
  await chooser.setFiles(FIXTURE); // 교체 (자동 선택 유지)

  const { rect } = frame01.variants.post.placements[0];
  const frame = await frameMapper(page);
  const probe = frame.at(rect.x + 4, rect.y + rect.height / 2);
  await expect
    .poll(async () => (await ghostAt(page, probe)).a)
    .toBeGreaterThan(40); // 교체 후에도 선택 상태(고스트)

  // ✕ → 사진 삭제: 슬롯이 자리표시(무채색)로 복귀, 유일한 사진이므로 다운로드 비활성
  await page.mouse.click(buttons.close.x, buttons.close.y);
  await expect
    .poll(async () => {
      const p = await pixelAt(page, center);
      return p.r - p.g;
    })
    .toBeLessThan(60);
  await expect(page.getByRole("button", { name: "다운로드" })).toBeDisabled();
  expect((await ghostAt(page, probe)).a).toBeLessThan(10); // 선택 UI도 사라짐
});

/**
 * 두 손가락 제스처 시뮬레이션 — 벌리면서(확대) 동시에 각도를 돌린다(회전).
 * Playwright touchscreen은 단일 터치만 지원해 PointerEvent를 직접 발생시킨다.
 */
async function twoFingerGesture(
  page: Page,
  origin: { x: number; y: number },
  options: { spread: number; turn: number; steps?: number },
) {
  await page.evaluate(
    async ({ origin, options }) => {
      const { spread, turn, steps = 18 } = options;
      const el = document.elementFromPoint(origin.x, origin.y)!;
      const opts = (id: number, cx: number, cy: number) => ({
        pointerId: id,
        pointerType: "touch",
        isPrimary: id === 1,
        clientX: cx,
        clientY: cy,
        bubbles: true,
        cancelable: true,
      });
      const at = (radius: number, angle: number, sign: number) => ({
        x: origin.x + sign * radius * Math.cos(angle),
        y: origin.y + sign * radius * Math.sin(angle),
      });
      const r0 = 40;
      let a = at(r0, 0, -1);
      let b = at(r0, 0, 1);
      el.dispatchEvent(new PointerEvent("pointerdown", opts(1, a.x, a.y)));
      el.dispatchEvent(new PointerEvent("pointerdown", opts(2, b.x, b.y)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const radius = r0 * (1 + (spread - 1) * t);
        const angle = turn * t;
        a = at(radius, angle, -1);
        b = at(radius, angle, 1);
        window.dispatchEvent(
          new PointerEvent("pointermove", opts(1, a.x, a.y)),
        );
        window.dispatchEvent(
          new PointerEvent("pointermove", opts(2, b.x, b.y)),
        );
        await new Promise((r) => setTimeout(r, 10));
      }
      window.dispatchEvent(new PointerEvent("pointerup", opts(1, a.x, a.y)));
      window.dispatchEvent(new PointerEvent("pointerup", opts(2, b.x, b.y)));
    },
    { origin, options },
  );
}

test("두 손가락으로 확대와 회전이 동시에 된다 (기획 확정 2026-07-29)", async ({
  page,
}) => {
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(center.x, center.y);
  await (
    await chooserPromise
  ).setFiles(path.join(__dirname, "fixtures/photo-redblue.png"));
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();
  const before = await ghostBBox(page);

  // 슬롯 중앙에서 벌리면서(1.6배) 시계 방향 90°까지 돌린다
  await twoFingerGesture(page, center, { spread: 1.6, turn: Math.PI / 2 });

  const { rect } = frame01.variants.post.placements[0];
  const frame = await frameMapper(page);
  // 회전: +90° → 사진 왼쪽(빨강)이 슬롯 위쪽으로 온다
  const top = await pixelAt(
    page,
    frame.at(rect.x + rect.width / 2, rect.y + 20),
  );
  const bottom = await pixelAt(
    page,
    frame.at(rect.x + rect.width / 2, rect.y + rect.height - 20),
  );
  expect(top.r - top.b).toBeGreaterThan(100);
  expect(bottom.b - bottom.r).toBeGreaterThan(100);

  // 확대: 같은 제스처로 사진(고스트)의 면적이 커졌다
  // (회전이 섞이면 바운딩 박스 폭은 줄 수 있어 면적으로 판정한다)
  const after = await ghostBBox(page);
  expect(after.count).toBeGreaterThan(before.count * 1.3);

  // 확대·회전 후에도 선택은 유지된다 (실기기 제보: 확대하면 선택이 풀림)
  const outside = frame.at(rect.x - 40, rect.y + rect.height / 2);
  expect((await ghostAt(page, outside)).a).toBeGreaterThan(40);
});

test("미선택 사진은 드래그해도 움직이지 않는다 (스펙 06)", async ({ page }) => {
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(center.x, center.y);
  await (
    await chooserPromise
  ).setFiles(path.join(__dirname, "fixtures/photo-redblue.png"));
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  // 사진 재탭으로 해제 후 드래그 시도
  await page.mouse.click(center.x, center.y);

  const before = await pixelAt(page, center);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 200, center.y, { steps: 8 });
  await page.mouse.up();
  const after = await pixelAt(page, center);
  // 미선택 → 위치 불변 (중앙 경계색 그대로)
  expect(Math.abs(after.r - before.r)).toBeLessThan(25);
  expect(Math.abs(after.b - before.b)).toBeLessThan(25);
});

test("클릭 가능한 요소에 pointer 커서가 보인다", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "커서는 데스크톱(호버) 전용 검증",
  );
  await openEditor(page, "frame01");
  // 버튼류: Tailwind v4 preflight 복원 확인
  const toggle = page.getByRole("button", { name: "Story 9:16" });
  expect(await toggle.evaluate((el) => getComputedStyle(el).cursor)).toBe(
    "pointer",
  );
  // 비활성 다운로드 버튼은 pointer가 아니어야 한다
  expect(
    await page
      .getByRole("button", { name: "다운로드" })
      .evaluate((el) => getComputedStyle(el).cursor),
  ).not.toBe("pointer");

  // 빈 슬롯의 + 배지(DOM 버튼) → pointer
  const center = await placementCenter(page, frame01, "post", "left");
  expect(
    await page
      .locator('[data-testid="attach-left"]')
      .evaluate((el) => getComputedStyle(el).cursor),
  ).toBe("pointer");
  const containerCursor = () =>
    page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector(
            '[data-testid="editor-canvas"] canvas',
          ) as HTMLElement,
        ).cursor,
    );

  // 사진 첨부 후 호버 → grab
  await attachPhoto(page, center);
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();
  await page.mouse.move(center.x + 5, center.y + 5);
  await page.mouse.move(center.x, center.y);
  await expect.poll(containerCursor).toBe("grab");
});

test("홈으로 나갔다 다시 들어오면 편집 상태가 초기화된다", async ({ page }) => {
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  await attachPhoto(page, center);
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  await page.getByRole("link", { name: /Home/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.locator("main ul li a").first().click();
  await expect(page).toHaveURL(/\/editor\/frame01$/);

  // 초기화 확인: 다운로드 비활성 + 슬롯은 자리표시(무채색)로 복귀
  await expect(page.getByRole("button", { name: "다운로드" })).toBeDisabled();
  const p = await pixelAt(
    page,
    await placementCenter(page, frame01, "post", "left"),
  );
  expect(p.r - p.g).toBeLessThan(60);
});

test("비율 전환 시 사진이 유지된다", async ({ page }) => {
  const errors = trackErrors(page);
  await openEditor(page, "frame01");

  await attachPhoto(page, await placementCenter(page, frame01, "post", "left"));
  await expect
    .poll(async () => {
      const p = await pixelAt(
        page,
        await placementCenter(page, frame01, "post", "left"),
      );
      return p.r - p.g;
    })
    .toBeGreaterThan(120);

  await page.getByRole("button", { name: "Story 9:16" }).click();
  await expect
    .poll(async () => {
      const p = await pixelAt(
        page,
        await placementCenter(page, frame01, "story", "left"),
      );
      return p.r - p.g;
    })
    .toBeGreaterThan(120);

  await page.getByRole("button", { name: "Post 4:5" }).click();
  await expect
    .poll(async () => {
      const p = await pixelAt(
        page,
        await placementCenter(page, frame01, "post", "left"),
      );
      return p.r - p.g;
    })
    .toBeGreaterThan(120);
  expect(errors).toEqual([]);
});

test("캔버스 바깥 페이지 영역 탭으로도 선택이 해제된다 (스펙 06)", async ({
  page,
}) => {
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(center.x, center.y);
  await (
    await chooserPromise
  ).setFiles(path.join(__dirname, "fixtures/photo-redblue.png"));
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  // 자동 선택 → 고스트 확인
  const { rect } = frame01.variants.post.placements[0];
  const frame = await frameMapper(page);
  const probe = frame.at(rect.x - 40, rect.y + rect.height / 2);
  await expect
    .poll(async () => (await ghostAt(page, probe)).a)
    .toBeGreaterThan(40);

  // 스테이지 바깥 페이지 여백(좌측 패딩) 탭 → 해제
  await page.mouse.click(
    Math.max(2, frame.stage.x - 8),
    frame.stage.y + frame.stage.height / 2,
  );
  await expect
    .poll(async () => (await ghostAt(page, probe)).a)
    .toBeLessThan(10);
});

test("에디터 진입 시 반대 비율 에셋을 미리 받는다 (사용자 확정 2026-07-29)", async ({
  page,
}) => {
  const requested = new Set<string>();
  page.on("request", (r) => {
    const url = r.url();
    if (url.includes("/frames/")) requested.add(url.split("/frames/")[1]);
  });
  await openEditor(page, "frame01"); // post로 진입

  // 보이는 post 에셋은 물론, 전환 대비로 story 에셋까지 받아둔다 (전환 시 깜빡임 방지).
  // frame01은 v2 사각 슬롯이라 마스크 파일이 없다 (스펙 01)
  await expect
    .poll(
      () =>
        ["frame01/story/base.webp", "frame01/story/overlay.webp"].filter(
          (asset) => requested.has(asset),
        ).length,
    )
    .toBe(2);
});

test("마스크 있는 템플릿은 반대 비율 마스크도 미리 받는다", async ({
  page,
}) => {
  const requested = new Set<string>();
  page.on("request", (r) => {
    const url = r.url();
    if (url.includes("/frames/")) requested.add(url.split("/frames/")[1]);
  });
  await openEditor(page, "frame02"); // post로 진입 — frame02는 마스크 슬롯 보유

  await expect
    .poll(
      () =>
        [
          "frame02/story/base.webp",
          "frame02/story/overlay.webp",
          "frame02/story/mask-stars.png",
        ].filter((asset) => requested.has(asset)).length,
    )
    .toBe(3);
});

test("조작 중에만 미리보기 해상도를 낮춘다 (사용자 확정 2026-07-29)", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chrome",
    "DPR이 2보다 큰 프로젝트에서만 차이를 관측할 수 있다",
  );
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  await attachPhoto(page, center); // 자동 선택
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  const canvasRatio = () =>
    page.evaluate(() => {
      const c = document.querySelector(
        '[data-testid="editor-canvas"] canvas',
      ) as HTMLCanvasElement;
      return c.width / c.clientWidth;
    });
  const idle = await canvasRatio();
  expect(idle).toBeGreaterThan(2); // 정지 상태는 기기 해상도 그대로

  // 드래그 중에는 2로 낮아진다
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 40, center.y, { steps: 4 });
  await expect.poll(canvasRatio).toBe(2);

  // 손을 떼면 되돌아온다
  await page.mouse.up();
  await expect.poll(canvasRatio).toBe(idle);
});

test("프레임 좌우 여백 탭으로 선택이 해제된다 (기획 확정 2026-07-29)", async ({
  page,
}) => {
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  await attachPhoto(page, center); // 자동 선택
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  const { rect } = frame01.variants.post.placements[0];
  const frame = await frameMapper(page);
  const probe = frame.at(rect.x + 4, rect.y + rect.height / 2);
  await expect
    .poll(async () => (await ghostAt(page, probe)).a)
    .toBeGreaterThan(40);

  // 프레임 왼쪽 바깥(눈에는 빈 여백이지만 스테이지 캔버스 안쪽) 탭 → 해제
  const frameLeft = Number(
    await page
      .locator('[data-testid="editor-canvas"]')
      .getAttribute("data-frame-left"),
  );
  test.skip(
    frameLeft < 6,
    "이 뷰포트는 프레임이 폭을 꽉 채워 좌우 여백이 없다",
  );
  await page.mouse.click(frame.stage.x + frameLeft / 2, center.y);
  await expect
    .poll(async () => (await ghostAt(page, probe)).a)
    .toBeLessThan(10);
});

test("슬롯 밖 고스트 영역에서도 드래그가 동작한다 (제스처 표면, 스펙 06)", async ({
  page,
}) => {
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  // 가로로 긴 redblue → cover 시 좌우로 슬롯 밖 고스트가 넓다
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(center.x, center.y);
  await (
    await chooserPromise
  ).setFiles(path.join(__dirname, "fixtures/photo-redblue.png"));
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  // 슬롯 왼쪽 바깥, 고스트가 실제로 보이는 지점
  const { rect } = frame01.variants.post.placements[0];
  const frame = await frameMapper(page);
  const ghostPoint = frame.at(rect.x - 30, rect.y + rect.height / 2);
  await expect
    .poll(async () => (await ghostAt(page, ghostPoint)).a)
    .toBeGreaterThan(40);

  // 고스트 지점에서 드래그 시작 → 사진이 실제로 이동한다 (슬롯 밖인데도 제스처 동작)
  await page.mouse.move(ghostPoint.x, ghostPoint.y);
  await page.mouse.down();
  await page.mouse.move(ghostPoint.x + 300, ghostPoint.y, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const p = await pixelAt(page, center);
      return p.r - p.b; // 오른쪽 드래그 → 사진 왼쪽(빨강)이 슬롯 중앙에
    })
    .toBeGreaterThan(100);
});

/**
 * 고스트 레이어의 불투명 픽셀 가로 범위와 면적 (캔버스 백킹 좌표).
 * 면적(count)은 회전에 불변이라 회전과 확대가 섞인 제스처의 확대 판정에 쓴다.
 */
async function ghostBBox(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelectorAll(
      '[data-testid="editor-canvas"] canvas',
    )[1] as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = -1;
    let count = 0;
    for (let y = 0; y < c.height; y += 3) {
      for (let x = 0; x < c.width; x += 3) {
        if (d[(y * c.width + x) * 4 + 3] > 0) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    return { minX, maxX, count, dpr: c.width / c.clientWidth };
  });
}

test("고스트가 프레임 밖으로 넘쳐도 잘리지 않는다 (기획 피드백 2026-07-29)", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "프레임 좌우 여백이 있어야 넘침을 관측할 수 있다 — 모바일 뷰포트는 프레임이 폭을 꽉 채운다",
  );
  await openEditor(page, "frame02");
  await page.getByRole("button", { name: "Story 9:16" }).click();
  const root = page.locator('[data-testid="editor-canvas"]');
  await expect
    .poll(async () => Number(await root.getAttribute("data-frame-height")))
    .toBeGreaterThan(0);

  // 전체 너비 슬롯 — cover 상태에서 사진 바운딩 박스가 프레임 밖으로 나간다
  const main = frame02.variants.story.placements.find(
    (p: { slot: string }) => p.slot === "main",
  ).rect;
  const frame = await frameMapper(page);
  const center = frame.at(main.x + main.width / 2, main.y + main.height / 2);
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(center.x, center.y);
  await (
    await chooserPromise
  ).setFiles(path.join(__dirname, "fixtures/photo-redblue.png"));
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  // 고스트가 프레임 왼쪽 경계보다 더 왼쪽에도 그려진다
  const frameLeft = Number(await root.getAttribute("data-frame-left"));
  await expect
    .poll(async () => {
      const g = await ghostBBox(page);
      return frameLeft * g.dpr - g.minX; // 프레임 밖으로 삐져나온 px
    })
    .toBeGreaterThan(2);
});

test("사진 밖에서 핀치해도 배율이 조정된다 (기획 피드백 2026-07-29)", async ({
  page,
}) => {
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  await attachPhoto(page, center); // 자동 선택
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();
  const before = await ghostBBox(page);

  // 사진 바운딩 박스 한참 아래(프레임 여백)에서 두 손가락 벌리기
  const { rect } = frame01.variants.post.placements[0];
  const frame = await frameMapper(page);
  const pinch = frame.at(rect.x + rect.width / 2, rect.y + rect.height + 500);
  await twoFingerGesture(page, pinch, { spread: 2.5, turn: 0 });

  // 고스트(=사진 전체)가 실제로 커졌다
  await expect
    .poll(async () => {
      const after = await ghostBBox(page);
      return (after.maxX - after.minX) / (before.maxX - before.minX);
    })
    .toBeGreaterThan(1.15);
});

test("사진 밖에서 드래그해도 사진이 이동한다 (기획 피드백 2026-07-29)", async ({
  page,
}) => {
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  // 좌 빨강/우 파랑 사진 — 중앙은 경계색, 이동하면 한쪽 색이 중앙에 온다
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(center.x, center.y);
  await (
    await chooserPromise
  ).setFiles(path.join(__dirname, "fixtures/photo-redblue.png"));
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  // 사진 바운딩 박스 밖(프레임 우측 여백)에서 드래그를 시작한다
  const { rect } = frame01.variants.post.placements[0];
  const frame = await frameMapper(page);
  const outsidePhoto = frame.at(950, rect.y + rect.height / 2);
  await expect
    .poll(async () => (await ghostAt(page, outsidePhoto)).a)
    .toBeLessThan(10); // 고스트조차 없는 = 사진 영역 완전 바깥

  await page.mouse.move(outsidePhoto.x, outsidePhoto.y);
  await page.mouse.down();
  await page.mouse.move(outsidePhoto.x + 300, outsidePhoto.y, { steps: 10 });
  await page.mouse.up();

  // 오른쪽으로 끌었으므로 사진 왼쪽(빨강)이 슬롯 중앙에 온다
  await expect
    .poll(async () => {
      const p = await pixelAt(page, center);
      return p.r - p.b;
    })
    .toBeGreaterThan(100);
});

test("편집한 위치가 post↔story 전환에도 유지된다 (초점 공유, 스펙 06)", async ({
  page,
}) => {
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  // 좌 빨강/우 파랑 사진 — 기본(중앙)은 경계, 오른쪽 드래그로 빨강을 중앙에 둔다
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(center.x, center.y);
  await (
    await chooserPromise
  ).setFiles(path.join(__dirname, "fixtures/photo-redblue.png"));
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 300, center.y, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const p = await pixelAt(page, center);
      return p.r - p.b;
    })
    .toBeGreaterThan(100);

  // story에서도 같은 지점(빨강)이 슬롯 중앙에 온다 — 초점이 사진 속성으로 공유되므로
  await page.getByRole("button", { name: "Story 9:16" }).click();
  await expect
    .poll(async () => {
      const p = await pixelAt(
        page,
        await placementCenter(page, frame01, "story", "left"),
      );
      return p.r - p.b;
    })
    .toBeGreaterThan(100);

  // post로 복귀해도 그대로
  await page.getByRole("button", { name: "Post 4:5" }).click();
  await expect
    .poll(async () => {
      const p = await pixelAt(
        page,
        await placementCenter(page, frame01, "post", "left"),
      );
      return p.r - p.b;
    })
    .toBeGreaterThan(100);
});

test("터치 탭으로 📷 교체·✕ 사진 삭제가 동작한다 (스펙 06)", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chrome",
    "실기기 회귀 방지 — 터치 이벤트 경로는 모바일 프로젝트에서 검증",
  );
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.touchscreen.tap(center.x, center.y);
  await (await chooserPromise).setFiles(FIXTURE); // 자동 선택
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  const buttons = await selectionButtons(page);
  const { rect } = frame01.variants.post.placements[0];
  const frame = await frameMapper(page);
  const probe = frame.at(rect.x + 4, rect.y + rect.height / 2);
  await expect
    .poll(async () => (await ghostAt(page, probe)).a)
    .toBeGreaterThan(40); // 선택 상태(고스트)

  // 📷 터치 탭 → 파일 선택창 (탭 완료 시점 실행 — iOS user activation 경로)
  const replacePromise = page.waitForEvent("filechooser");
  await page.touchscreen.tap(buttons.camera.x, buttons.camera.y);
  await (await replacePromise).setFiles(FIXTURE);

  // ✕ 터치 탭 → 사진 삭제: 자리표시 복귀 + 다운로드 비활성
  await expect
    .poll(async () => (await ghostAt(page, probe)).a)
    .toBeGreaterThan(40);
  await page.touchscreen.tap(buttons.close.x, buttons.close.y);
  await expect
    .poll(async () => {
      const p = await pixelAt(page, center);
      return p.r - p.g;
    })
    .toBeLessThan(60);
  await expect(page.getByRole("button", { name: "다운로드" })).toBeDisabled();

  // 빈 슬롯 터치 탭 → 다시 파일 선택창 (첨부 플로우 복귀)
  const reattachPromise = page.waitForEvent("filechooser");
  await page.touchscreen.tap(center.x, center.y);
  await (await reattachPromise).setFiles(FIXTURE);
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();
});

test("드래그를 이웃 슬롯 위에서 놓아도 파일 선택창이 열리지 않는다", async ({
  page,
}) => {
  await openEditor(page, "frame01");
  const left = await placementCenter(page, frame01, "post", "left");
  await attachPhoto(page, left);
  await expect
    .poll(async () => (await pixelAt(page, left)).r)
    .toBeGreaterThan(180);

  const right = await placementCenter(page, frame01, "post", "right");
  let chooserOpened = false;
  page.on("filechooser", () => {
    chooserOpened = true;
  });
  await page.mouse.move(left.x, left.y);
  await page.mouse.down();
  await page.mouse.move(right.x, right.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(chooserOpened).toBe(false);
});
