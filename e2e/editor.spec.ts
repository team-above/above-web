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

/** 캔버스 표시 좌표계에서 특정 placement 중심의 페이지 좌표를 구한다 */
async function placementCenter(
  page: Page,
  template: ReturnType<typeof loadTemplate>,
  variant: "post" | "story",
  slotId: string,
) {
  const canvas = page.locator('[data-testid="editor-canvas"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const variantData = template.variants[variant];
  const placement = variantData.placements.find(
    (p: { slot: string }) => p.slot === slotId,
  );
  const scale = box.width / variantData.canvas.width;
  return {
    x: box.x + (placement.rect.x + placement.rect.width / 2) * scale,
    y: box.y + (placement.rect.y + placement.rect.height / 2) * scale,
  };
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
  canvasWidth: number,
) {
  return page.evaluate(
    ({ rect, canvasWidth }) => {
      const el = document.querySelector(
        '[data-testid="editor-canvas"] canvas',
      ) as HTMLCanvasElement;
      const scale = el.width / canvasWidth;
      const data = el
        .getContext("2d")!
        .getImageData(
          Math.round(rect.x * scale),
          Math.round(rect.y * scale),
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
    { rect, canvasWidth },
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
    .poll(async () => (await countSlotColors(page, slotRect, 1080)).red)
    .toBeGreaterThan(1000); // 사진이 슬롯을 채움
  expect((await countSlotColors(page, slotRect, 1080)).green).toBeGreaterThan(
    30,
  ); // 낙서가 사진 위에 남음
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
    .poll(async () => (await countSlotColors(page, mainRect, 1080)).red)
    .toBeGreaterThan(1000);
  expect((await countSlotColors(page, mainRect, 1080)).blue).toBeGreaterThan(
    100,
  ); // 하늘색 별이 사진 위에 남음
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
    .poll(async () => (await countSlotColors(page, monRect, 1080)).red)
    .toBeGreaterThan(300);
  // 라벨 텍스트(흰색)가 사진 위에 남음 — 라벨은 슬롯 상단 영역
  const labelArea = { ...monRect, height: Math.round(monRect.height * 0.3) };
  expect((await countSlotColors(page, labelArea, 1080)).white).toBeGreaterThan(
    10,
  );
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
  const canvas = page.locator('[data-testid="editor-canvas"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const { rect } = frame01.variants.post.placements[0];
  const scale = box.width / frame01.variants.post.canvas.width;
  const leftInside = {
    x: box.x + (rect.x + 4) * scale,
    y: box.y + (rect.y + rect.height / 2) * scale,
  };
  const edge = await pixelAt(page, leftInside);
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
  await expect
    .poll(async () => {
      const p = await pixelAt(page, center);
      return Math.max(p.r, p.b);
    })
    .toBeGreaterThan(150);

  // 첨부 직후 자동 선택 → 슬롯 왼쪽 바깥에 고스트(빨강)가 보인다
  const { rect } = frame01.variants.post.placements[0];
  const canvas = page.locator('[data-testid="editor-canvas"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const scale = box.width / frame01.variants.post.canvas.width;
  const outside = {
    x: box.x + (rect.x - 40) * scale,
    y: box.y + (rect.y + rect.height / 2) * scale,
  };
  await expect
    .poll(async () => (await ghostAt(page, outside)).a)
    .toBeGreaterThan(40);
  expect((await ghostAt(page, outside)).r).toBeGreaterThan(120);

  // 배경(슬롯 밖 남색 영역) 탭 → 선택 해제 → 고스트 사라짐
  await page.mouse.click(box.x + 60 * scale, box.y + 60 * scale);
  await expect
    .poll(async () => (await ghostAt(page, outside)).a)
    .toBeLessThan(10);

  // 사진 재탭 → 다시 선택(고스트), 한 번 더 탭 → 해제 (토글)
  await page.mouse.click(center.x, center.y);
  await expect
    .poll(async () => (await ghostAt(page, outside)).a)
    .toBeGreaterThan(40);
  await page.mouse.click(center.x, center.y);
  await expect
    .poll(async () => (await ghostAt(page, outside)).a)
    .toBeLessThan(10);
});

/** 선택 오버레이 버튼의 화면 좌표 (SelectionControls의 배치 로직 재현) */
async function selectionButtons(page: Page, slotIndex = 0) {
  const canvas = page.locator('[data-testid="editor-canvas"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const v = frame01.variants.post;
  const rect = v.placements[slotIndex].rect;
  const s = box.width / v.canvas.width;
  const pxc = (n: number) => n / s; // 화면 n px에 해당하는 캔버스 단위
  const cx = (val: number) =>
    Math.min(Math.max(val, pxc(22)), v.canvas.width - pxc(22));
  const cy = (val: number) =>
    Math.min(Math.max(val, pxc(22)), v.canvas.height - pxc(22));
  const toScreen = (x: number, y: number) => ({
    x: box.x + x * s,
    y: box.y + y * s,
  });
  return {
    close: toScreen(cx(rect.x + rect.width), cy(rect.y)),
    camera: toScreen(
      cx(rect.x + rect.width / 2),
      cy(rect.y + rect.height + pxc(32)),
    ),
    rotate: toScreen(cx(rect.x + rect.width / 2), cy(rect.y - pxc(32))),
    slotCenterScreen: toScreen(
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
  const canvas = page.locator('[data-testid="editor-canvas"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const scale = box.width / frame01.variants.post.canvas.width;
  const probe = {
    x: box.x + (rect.x + 4) * scale,
    y: box.y + (rect.y + rect.height / 2) * scale,
  };
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

test("궤도 핸들 드래그로 회전한다 (90° 스냅)", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "마우스 궤도 드래그는 데스크톱에서 검증 (코드 경로는 동일)",
  );
  await openEditor(page, "frame01");
  const center = await placementCenter(page, frame01, "post", "left");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(center.x, center.y);
  await (
    await chooserPromise
  ).setFiles(path.join(__dirname, "fixtures/photo-redblue.png"));
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  const buttons = await selectionButtons(page);
  const c = buttons.slotCenterScreen;
  const radius = Math.hypot(buttons.rotate.x - c.x, buttons.rotate.y - c.y);
  // 핸들(위쪽)에서 시작해 시계 방향으로 동쪽(+90°)까지 원을 그리며 드래그
  await page.mouse.move(buttons.rotate.x, buttons.rotate.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    const theta = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
    await page.mouse.move(
      c.x + radius * Math.cos(theta),
      c.y + radius * Math.sin(theta),
    );
  }
  await page.mouse.up();

  // +90° 회전: 사진 왼쪽(빨강)이 슬롯 위쪽으로 온다
  const { rect } = frame01.variants.post.placements[0];
  const canvas = page.locator('[data-testid="editor-canvas"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const scale = box.width / frame01.variants.post.canvas.width;
  const top = await pixelAt(page, {
    x: box.x + (rect.x + rect.width / 2) * scale,
    y: box.y + (rect.y + 20) * scale,
  });
  const bottom = await pixelAt(page, {
    x: box.x + (rect.x + rect.width / 2) * scale,
    y: box.y + (rect.y + rect.height - 20) * scale,
  });
  expect(top.r - top.b).toBeGreaterThan(100);
  expect(bottom.b - bottom.r).toBeGreaterThan(100);
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

  // 배경 탭으로 해제 후 드래그 시도
  const canvas = page.locator('[data-testid="editor-canvas"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const scale = box.width / frame01.variants.post.canvas.width;
  await page.mouse.click(box.x + 60 * scale, box.y + 60 * scale);

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
  const canvas = page.locator('[data-testid="editor-canvas"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const scale = box.width / frame01.variants.post.canvas.width;
  const ghostPoint = {
    x: box.x + (rect.x - 30) * scale,
    y: box.y + (rect.y + rect.height / 2) * scale,
  };
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
  const canvas = page.locator('[data-testid="editor-canvas"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const scale = box.width / frame01.variants.post.canvas.width;
  const probe = {
    x: box.x + (rect.x + 4) * scale,
    y: box.y + (rect.y + rect.height / 2) * scale,
  };
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
