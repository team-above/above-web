import { describe, expect, it } from "vitest";
import {
  clampTransform,
  coverScale,
  decodeTargetSize,
  initialTransform,
  MAX_ZOOM_FACTOR,
  zoomAt,
} from "./transform";

const photo = { width: 400, height: 300 };
const rect = { width: 200, height: 300 };

describe("coverScale", () => {
  it("rect를 빈틈 없이 채우는 최소 배율을 계산한다", () => {
    // 세로가 병목: 300/300 = 1 > 200/400 = 0.5
    expect(coverScale(photo, rect)).toBe(1);
    expect(coverScale({ width: 100, height: 100 }, rect)).toBe(3);
  });
});

describe("initialTransform", () => {
  it("cover 배율로 중앙 정렬한다", () => {
    const t = initialTransform(photo, rect);
    expect(t.scale).toBe(1);
    expect(t.x).toBe((200 - 400) / 2); // -100 (가로 중앙)
    expect(t.y).toBe(0);
  });
});

describe("clampTransform", () => {
  it("스케일을 [cover, cover×3] 범위로 강제한다", () => {
    expect(clampTransform({ x: 0, y: 0, scale: 0.1 }, photo, rect).scale).toBe(
      1,
    );
    expect(clampTransform({ x: 0, y: 0, scale: 99 }, photo, rect).scale).toBe(
      MAX_ZOOM_FACTOR,
    );
  });

  it("오프셋이 빈틈을 만들지 않게 강제한다", () => {
    const t = clampTransform({ x: 50, y: 10, scale: 1 }, photo, rect);
    expect(t.x).toBe(0); // 오른쪽으로 밀어 왼쪽 빈틈 → 0으로
    expect(t.y).toBe(0); // 세로는 딱 맞아서 항상 0
    const t2 = clampTransform({ x: -999, y: -999, scale: 1 }, photo, rect);
    expect(t2.x).toBe(rect.width - 400); // -200
    expect(t2.y).toBe(0);
  });
});

describe("zoomAt", () => {
  it("기준점을 고정한 채 확대한다", () => {
    const start = initialTransform(photo, rect); // scale 1, x -100
    const focus = { x: 100, y: 150 }; // rect 중앙
    const zoomed = zoomAt(start, 2, focus, photo, rect);
    expect(zoomed.scale).toBe(2);
    // 중앙 기준 확대: 중앙이 가리키던 사진 지점이 그대로 중앙에 남는다
    expect(zoomed.x).toBeCloseTo(focus.x - (focus.x - start.x) * 2);
  });

  it("상한을 넘는 확대와 하한을 넘는 축소를 클램프한다", () => {
    const start = initialTransform(photo, rect);
    const over = zoomAt(start, 100, { x: 0, y: 0 }, photo, rect);
    expect(over.scale).toBe(MAX_ZOOM_FACTOR);
    const under = zoomAt(start, 0.01, { x: 0, y: 0 }, photo, rect);
    expect(under.scale).toBe(1);
    expect(under.x).toBe(start.x); // 축소 불가 → 배치 불변
  });
});

describe("decodeTargetSize", () => {
  it("최장변이 상한 이하면 원본 크기 유지", () => {
    expect(decodeTargetSize({ width: 2000, height: 1000 })).toEqual({
      width: 2000,
      height: 1000,
    });
  });

  it("최장변이 상한을 넘으면 비율 유지 축소", () => {
    expect(decodeTargetSize({ width: 8640, height: 4320 })).toEqual({
      width: 2160,
      height: 1080,
    });
  });
});
