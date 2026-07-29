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
  it("표시 너비는 비율 간 공통이다 — 전환 시 캔버스 너비가 흔들리지 않는다", () => {
    const viewport = { width: 393, height: 700 };
    const post = fitToViewport("post", viewport);
    const story = fitToViewport("story", viewport);
    expect(post.width).toBeCloseTo(story.width);
    expect(post.scale).toBeCloseTo(story.scale);
    expect(post.height).toBeLessThan(story.height); // post는 짧다 (위아래 여백)
  });

  it("세로가 좁은 뷰포트에서는 story(세로 최장)가 병목 — 공통 스케일이 따라간다", () => {
    const fitted = fitToViewport("post", { width: 1080, height: 675 });
    expect(fitted.scale).toBeCloseTo(675 / 1920);
    expect(fitted.width).toBeCloseTo(1080 * (675 / 1920));
  });

  it("가로가 좁은 뷰포트에서는 너비에 맞춰 축소한다", () => {
    const fitted = fitToViewport("story", { width: 540, height: 3000 });
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
