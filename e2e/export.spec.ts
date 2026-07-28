import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Download, type Page } from "@playwright/test";
import { PNG } from "pngjs";

const loadTemplate = (id: string) =>
  JSON.parse(
    readFileSync(path.join(__dirname, `../src/templates/${id}.json`), "utf8"),
  );
const frame01 = loadTemplate("frame01");
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

async function attachToSlot(
  page: Page,
  variant: "post" | "story",
  slotId: string,
) {
  const canvas = page.locator('[data-testid="editor-canvas"] canvas').first();
  const box = (await canvas.boundingBox())!;
  const variantData = frame01.variants[variant];
  const placement = variantData.placements.find(
    (p: { slot: string }) => p.slot === slotId,
  );
  const scale = box.width / variantData.canvas.width;
  const chooserPromise = page.waitForEvent("filechooser");
  await page.mouse.click(
    box.x + (placement.rect.x + placement.rect.width / 2) * scale,
    box.y + (placement.rect.y + placement.rect.height / 2) * scale,
  );
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
  await openEditor(page, "frame01");
  await attachToSlot(page, "post", "left");

  const { download, png } = await downloadPng(page);
  expect(download.suggestedFilename()).toBe("above-frame01-post.png");
  expect(png.width).toBe(1080);
  expect(png.height).toBe(1350);

  // 채운 슬롯 중심 = 빨강, 빈 슬롯 중심 = 자리표시 회색(배지 흰색 아님 — AC2)
  const left = frame01.variants.post.placements[0].rect;
  const right = frame01.variants.post.placements[1].rect;
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
  await expect(page).toHaveURL(/\/editor\/frame01$/);
  await expect(page.getByText("저장했어요")).toBeVisible();
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("story 비율로 내보내면 1080×1920", async ({ page }) => {
  await openEditor(page, "frame01");
  await attachToSlot(page, "post", "left");
  await page.getByRole("button", { name: "Story 9:16" }).click();
  // 스토리 캔버스(9:16) 로드 완료 대기 — 전환 직후엔 스테이지가 아직 없다
  const canvas = page.locator('[data-testid="editor-canvas"] canvas').first();
  await expect
    .poll(async () => {
      const box = await canvas.boundingBox();
      return box ? box.height / box.width : 0;
    })
    .toBeGreaterThan(1.7);
  const { download, png } = await downloadPng(page);
  expect(download.suggestedFilename()).toBe("above-frame01-story.png");
  expect(png.width).toBe(1080);
  expect(png.height).toBe(1920);
});

test("사진이 없으면 다운로드 버튼이 비활성이다", async ({ page }) => {
  await openEditor(page, "frame01");
  await expect(page.getByRole("button", { name: "다운로드" })).toBeDisabled();
});

test("편집 없이 done에 직접 접근하면 에디터로 돌려보낸다", async ({ page }) => {
  await page.goto("/editor/frame01/done");
  await expect(page).toHaveURL(/\/editor\/frame01$/);
});
