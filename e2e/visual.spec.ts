import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * 시각 회귀 — 스펙 03 수용 기준 1 (스펙 01 AC3 이월 해소).
 * 사진 없는 초기 캔버스(메인 레이어) = base + overlay 합성과 픽셀 수준으로 일치해야 한다.
 * 렌더 결과가 시안(base=원본 시안 그대로)과 같음을 보장한다. 데스크톱 프로젝트에서만 실행.
 */
const TEMPLATE_IDS = [
  "frame01",
  "frame02",
  "frame03",
  "frame04",
  "frame05",
  "frame06",
];
const VARIANTS = ["post", "story"] as const;

/** 템플릿 JSON에서 base/overlay 에셋 경로를 읽는다 (포맷 변경에 따라오게) */
function assetPaths(id: string, variant: "post" | "story"): [string, string] {
  const template = JSON.parse(
    readFileSync(path.join(__dirname, `../src/templates/${id}.json`), "utf8"),
  );
  const { base, overlay } = template.variants[variant].assets;
  return [base, overlay];
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
              async ([baseSrc, overlaySrc]) => {
                const canvasEl = document.querySelector(
                  '[data-testid="editor-canvas"] canvas',
                ) as HTMLCanvasElement;
                const { width, height } = canvasEl;
                const actual = canvasEl
                  .getContext("2d")!
                  .getImageData(0, 0, width, height).data;
                // 아직 base가 안 그려졌으면(전부 투명) 실패값 반환 → poll 재시도
                if (actual[3] === 0 && actual[actual.length - 1] === 0)
                  return 1;

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
              assetPaths(id, variant),
            ),
          { timeout: 10000 },
        )
        // 3%: 고대비 스트로크(frame05 낙서)의 서브픽셀 보간 차이 허용치.
        // 레이어 순서·에셋 회귀는 수십% 차이를 내므로 감지력은 유지된다
        .toBeLessThan(0.03);
    });
  }
}
