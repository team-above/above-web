import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Download, type Page } from "@playwright/test";
import { PNG } from "pngjs";

const loadTemplate = (id: string) =>
  JSON.parse(
    readFileSync(path.join(__dirname, `../src/templates/${id}.json`), "utf8"),
  );
const duo = loadTemplate("duo");
const FIXTURE = path.join(__dirname, "fixtures/photo-red.png");

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openEditor(page: Page, frameId: string) {
  await page.goto(`/editor/${frameId}`);
  await expect(
    page.locator('[data-testid="editor-canvas"] canvas').first(),
  ).toBeVisible();
}

/**
 * story 프레임이 실제로 그려질 때까지 대기 — 비율 전환 직후엔 에셋 로딩으로 캔버스가 잠시 사라진다.
 * 스테이지는 편집 영역 전체를 덮으므로 프레임 크기는 data 속성으로 판정한다.
 */
async function waitForStoryFrame(page: Page) {
  const root = page.locator('[data-testid="editor-canvas"]');
  await expect
    .poll(async () => {
      const box = await root.locator("canvas").first().boundingBox();
      if (!box) return 0;
      const [w, h] = await Promise.all([
        root.getAttribute("data-frame-width"),
        root.getAttribute("data-frame-height"),
      ]);
      return Number(w) ? Number(h) / Number(w) : 0;
    })
    .toBeGreaterThan(1.7);
}

/** 프레임 좌표 → 페이지 좌표 (스테이지가 편집 영역 전체를 덮으므로 원점을 data 속성에서 읽는다) */
async function frameAt(page: Page, x: number, y: number) {
  const root = page.locator('[data-testid="editor-canvas"]');
  const box = (await root.locator("canvas").first().boundingBox())!;
  const [left, top, scale] = await Promise.all([
    root.getAttribute("data-frame-left"),
    root.getAttribute("data-frame-top"),
    root.getAttribute("data-frame-scale"),
  ]);
  return {
    x: box.x + Number(left) + x * Number(scale),
    y: box.y + Number(top) + y * Number(scale),
  };
}

async function attachToSlot(
  page: Page,
  variant: "post" | "story",
  slotId: string,
) {
  const placement = duo.variants[variant].placements.find(
    (p: { slot: string }) => p.slot === slotId,
  );
  const point = await frameAt(
    page,
    placement.rect.x + placement.rect.width / 2,
    placement.rect.y + placement.rect.height / 2,
  );
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(point.x, point.y);
  await (await chooserPromise).setFiles(FIXTURE);
  // 첨부 반영 대기 — 다운로드 버튼 활성화로 판단
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();
}

async function downloadPng(page: Page): Promise<{
  download: Download;
  png: PNG;
}> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "다운로드" }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  return { download, png: PNG.sync.read(readFileSync(filePath!)) };
}

const pixelOf = (png: PNG, x: number, y: number) => {
  const idx = (y * png.width + x) * 4;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
};

test("다운로드: 정확한 해상도 PNG + 집계 경유 후 에디터 복귀·토스트·상태 유지", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await openEditor(page, "duo");
  await attachToSlot(page, "post", "left");

  const { download, png } = await downloadPng(page);
  expect(download.suggestedFilename()).toBe("above-duo-post.png");
  expect(png.width).toBe(1080);
  expect(png.height).toBe(1350);

  // 채운 슬롯 중심 = 빨강, 빈 슬롯 중심 = 자리표시 회색(배지 흰색 아님 — AC2)
  const left = duo.variants.post.placements[0].rect;
  const right = duo.variants.post.placements[1].rect;
  const filled = pixelOf(
    png,
    left.x + Math.floor(left.width / 2),
    left.y + Math.floor(left.height / 2),
  );
  expect(filled.r - filled.g).toBeGreaterThan(120);
  const empty = pixelOf(
    png,
    right.x + Math.floor(right.width / 2),
    right.y + Math.floor(right.height / 2),
  );
  expect(empty.r).toBeGreaterThan(180); // 밝은 회색 자리표시
  expect(empty.r).toBeLessThan(230); // 배지(흰 원)가 섞였다면 235+
  expect(Math.abs(empty.r - empty.b)).toBeLessThan(12); // 무채색

  // 결과 화면 없음(기획 확정): 집계 라우트(done)를 스쳐 에디터로 자동 복귀 + 토스트, 상태 유지
  await expect(page).toHaveURL(/\/editor\/duo$/);
  await expect(page.getByText("저장했어요")).toBeVisible();
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("story 비율로 내보내면 1080×1920", async ({ page }) => {
  await openEditor(page, "duo");
  await attachToSlot(page, "post", "left");
  await page.getByRole("button", { name: "Story 9:16" }).click();
  // 스토리 캔버스(9:16) 로드 완료 대기 — 전환 직후엔 스테이지가 아직 없다
  await waitForStoryFrame(page);
  const { download, png } = await downloadPng(page);
  expect(download.suggestedFilename()).toBe("above-duo-story.png");
  expect(png.width).toBe(1080);
  expect(png.height).toBe(1920);
});

test("Shift+휠 회전(90° 스냅)이 미리보기와 내보내기에 반영된다", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "Shift+휠은 데스크톱 전용 조작",
  );
  await openEditor(page, "duo");
  // 좌 빨강/우 파랑 가로 사진 → 90° 회전하면 위 빨강/아래 파랑이 된다
  const rect = duo.variants.post.placements[0].rect;
  const center = await frameAt(
    page,
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(center.x, center.y);
  await (
    await chooserPromise
  ).setFiles(path.join(__dirname, "fixtures/photo-redblue.png"));
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();

  // Shift+휠 누적 800 → 91.7° → 90° 스냅
  await page.mouse.move(center.x, center.y);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 800);
  await page.keyboard.up("Shift");

  const { png } = await downloadPng(page);
  const top = pixelOf(png, rect.x + Math.floor(rect.width / 2), rect.y + 30);
  const bottom = pixelOf(
    png,
    rect.x + Math.floor(rect.width / 2),
    rect.y + rect.height - 30,
  );
  expect(top.r - top.b).toBeGreaterThan(100); // 사진 왼쪽(빨강)이 위로
  expect(bottom.b - bottom.r).toBeGreaterThan(100); // 오른쪽(파랑)이 아래로

  // 비율 전환 후에도 회전(사진 속성)이 유지된다 — story 내보내기에서도 위 빨강/아래 파랑
  await page.getByRole("button", { name: "Story 9:16" }).click();
  await waitForStoryFrame(page);
  const { png: storyPng } = await downloadPng(page);
  const storyRect = duo.variants.story.placements[0].rect;
  const storyTop = pixelOf(
    storyPng,
    storyRect.x + Math.floor(storyRect.width / 2),
    storyRect.y + 30,
  );
  const storyBottom = pixelOf(
    storyPng,
    storyRect.x + Math.floor(storyRect.width / 2),
    storyRect.y + storyRect.height - 30,
  );
  expect(storyTop.r - storyTop.b).toBeGreaterThan(100);
  expect(storyBottom.b - storyBottom.r).toBeGreaterThan(100);
});

test("사진이 없으면 다운로드 버튼이 비활성이다", async ({ page }) => {
  await openEditor(page, "duo");
  await expect(page.getByRole("button", { name: "다운로드" })).toBeDisabled();
});

test("편집 없이 done에 직접 접근하면 에디터로 돌려보낸다", async ({ page }) => {
  await page.goto("/editor/duo/done");
  await expect(page).toHaveURL(/\/editor\/duo$/);
});
