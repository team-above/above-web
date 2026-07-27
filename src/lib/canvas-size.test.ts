import { describe, expect, it } from "vitest";
import { EXPORT_SIZES, fitToViewport } from "./canvas-size";

describe("EXPORT_SIZES", () => {
  it("post는 4:5, story는 9:16 비율이다", () => {
    expect(EXPORT_SIZES.post.width / EXPORT_SIZES.post.height).toBeCloseTo(
      4 / 5,
    );
    expect(EXPORT_SIZES.story.width / EXPORT_SIZES.story.height).toBeCloseTo(
      9 / 16,
    );
  });
});

describe("fitToViewport", () => {
  it("세로가 좁은 뷰포트에서는 높이에 맞춰 축소한다", () => {
    const fitted = fitToViewport("post", { width: 1080, height: 675 });
    expect(fitted.scale).toBeCloseTo(0.5);
    expect(fitted.width).toBeCloseTo(540);
    expect(fitted.height).toBeCloseTo(675);
  });

  it("가로가 좁은 뷰포트에서는 너비에 맞춰 축소한다", () => {
    const fitted = fitToViewport("story", { width: 540, height: 1920 });
    expect(fitted.scale).toBeCloseTo(0.5);
    expect(fitted.width).toBeCloseTo(540);
    expect(fitted.height).toBeCloseTo(960);
  });

  it("비율은 항상 원본 내보내기 규격과 동일하게 유지된다", () => {
    const fitted = fitToViewport("post", { width: 393, height: 851 });
    expect(fitted.width / fitted.height).toBeCloseTo(
      EXPORT_SIZES.post.width / EXPORT_SIZES.post.height,
    );
  });
});
