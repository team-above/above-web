import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * 시각 회귀 — 스펙 03 수용 기준 1 (스펙 01 AC3 이월 해소).
 * 사진 없는 초기 캔버스(메인 레이어) = base + overlay 합성과 픽셀 수준으로 일치해야 한다.
 * 렌더 결과가 시안(base=원본 시안 그대로)과 같음을 보장한다. 데스크톱 프로젝트에서만 실행.
 */
const TEMPLATE_IDS = [
  "duo",
  "punching",
  "accent",
  "weeklydump",
  "doodle",
  "fourleafclover",
];
const VARIANTS = ["post", "story"] as const;

interface GrayBox {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

/** 템플릿 JSON에서 base/overlay 경로와 코드 자리표시(마스크 없는 슬롯) 정보를 읽는다 */
function assetPaths(
  id: string,
  variant: "post" | "story",
): [string, string, GrayBox[], { width: number; height: number }] {
  const template = JSON.parse(
    readFileSync(path.join(__dirname, `../src/templates/${id}.json`), "utf8"),
  );
  const v = template.variants[variant];
  const boxes: GrayBox[] = v.placements
    .filter((p: { mask?: string }) => !p.mask)
    .map((p: { rect: GrayBox; radius?: number }) => ({
      ...p.rect,
      radius: p.radius ?? 0,
    }));
  return [v.assets.base, v.assets.overlay, boxes, v.canvas];
}

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chrome",
    "시각 회귀는 데스크톱 프로젝트에서만 실행",
  );
});

for (const id of TEMPLATE_IDS) {
  for (const variant of VARIANTS) {
    test(`${id}/${variant} 초기 캔버스가 시안과 일치한다`, async ({ page }) => {
      await page.goto(`/editor/${id}`);
      if (variant === "story") {
        await page.getByRole("button", { name: "Story 9:16" }).click();
      }
      const canvas = page
        .locator('[data-testid="editor-canvas"] canvas')
        .first();
      await expect(canvas).toBeVisible();

      await expect
        .poll(
          () =>
            page.evaluate(
              async ([baseSrc, overlaySrc, grayBoxes, canvasSize]) => {
                // 스테이지가 편집 영역 전체를 덮으므로 프레임 영역만 잘라 비교한다 (스펙 06)
                const root = document.querySelector(
                  '[data-testid="editor-canvas"]',
                ) as HTMLElement;
                const canvasEl = root.querySelector(
                  "canvas",
                ) as HTMLCanvasElement;
                const dpr = canvasEl.width / canvasEl.clientWidth;
                const px = (name: string) =>
                  Math.round(Number(root.dataset[name]) * dpr);
                const [fx, fy, width, height] = [
                  px("frameLeft"),
                  px("frameTop"),
                  px("frameWidth"),
                  px("frameHeight"),
                ];
                if (width === 0 || height === 0) return 1;
                const actual = canvasEl
                  .getContext("2d")!
                  .getImageData(fx, fy, width, height).data;
                // 아직 base가 안 그려졌으면 실패값 반환 → poll 재시도.
                // 모서리는 라운드 클립으로 투명하므로 중앙 픽셀로 판정한다
                const center =
                  (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
                if (actual[center + 3] === 0) return 1;

                const load = (src: string) =>
                  new Promise<HTMLImageElement>((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = src;
                  });
                const [base, overlay] = await Promise.all([
                  load(baseSrc),
                  load(overlaySrc),
                ]);
                const off = document.createElement("canvas");
                off.width = width;
                off.height = height;
                const ctx = off.getContext("2d")!;
                ctx.drawImage(base, 0, 0, width, height);
                // 렌더러가 그리는 빈 슬롯 자리표시(회색, radius 포함)를 재현한다 (스펙 01)
                const sx = width / (canvasSize as { width: number }).width;
                const sy = height / (canvasSize as { height: number }).height;
                ctx.fillStyle = "#D9D9D9";
                for (const box of grayBoxes as {
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                  radius: number;
                }[]) {
                  ctx.beginPath();
                  ctx.roundRect(
                    box.x * sx,
                    box.y * sy,
                    box.width * sx,
                    box.height * sy,
                    box.radius * sx,
                  );
                  ctx.fill();
                }
                ctx.drawImage(overlay, 0, 0, width, height);
                const wanted = ctx.getImageData(0, 0, width, height).data;

                let bad = 0;
                let total = 0;
                for (let i = 0; i < actual.length; i += 16) {
                  total++;
                  if (
                    Math.abs(actual[i] - wanted[i]) > 24 ||
                    Math.abs(actual[i + 1] - wanted[i + 1]) > 24 ||
                    Math.abs(actual[i + 2] - wanted[i + 2]) > 24
                  ) {
                    bad++;
                  }
                }
                return bad / total;
              },
              assetPaths(id, variant) as [
                string,
                string,
                GrayBox[],
                { width: number; height: number },
              ],
            ),
          { timeout: 10000 },
        )
        // 3%: 고대비 스트로크(doodle 낙서)의 서브픽셀 보간 차이 허용치.
        // 레이어 순서·에셋 회귀는 수십% 차이를 내므로 감지력은 유지된다
        .toBeLessThan(0.03);
    });
  }
}
