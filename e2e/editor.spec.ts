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
