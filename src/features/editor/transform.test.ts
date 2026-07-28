import { describe, expect, it } from "vitest";
import {
  clampTransform,
  coverScale,
  decodeTargetSize,
  initialTransform,
  minScaleFor,
  rotateTo,
  snapAngle,
  SNAP_THRESHOLD,
  zoomAt,
} from "./transform";

const photo = { width: 400, height: 300 };
const rect = { width: 200, height: 300 };
const DEG = Math.PI / 180;

describe("minScaleFor / coverScale", () => {
  it("무회전: rect를 빈틈 없이 채우는 최소 배율", () => {
    expect(coverScale(photo, rect)).toBe(1); // 세로 병목 300/300
    expect(minScaleFor(photo, rect, 0)).toBe(1);
  });

  it("90° 회전: 사진의 가로/세로 역할이 바뀐다", () => {
    // 90°: 투영 W=300, H=200 → max(300/400, 200/300) = 0.75
    expect(minScaleFor(photo, rect, Math.PI / 2)).toBeCloseTo(0.75);
  });

  it("45° 회전: 대각 투영만큼 더 큰 배율이 필요하다", () => {
    const s = minScaleFor(photo, rect, Math.PI / 4);
    const proj = ((200 + 300) * Math.SQRT1_2) / 2; // 반투영
    expect(s).toBeCloseTo(Math.max((proj * 2) / 400, (proj * 2) / 300));
    expect(s).toBeGreaterThan(1);
  });
});

describe("initialTransform", () => {
  it("cover 배율 + 중앙(오프셋 0) + 무회전", () => {
    expect(initialTransform(photo, rect)).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    });
  });
});

describe("clampTransform", () => {
  it("스케일 하한(각도별 minScale)만 강제하고 상한은 없다", () => {
    expect(
      clampTransform({ x: 0, y: 0, scale: 0.1, rotation: 0 }, photo, rect)
        .scale,
    ).toBe(1);
    expect(
      clampTransform({ x: 0, y: 0, scale: 99, rotation: 0 }, photo, rect).scale,
    ).toBe(99);
  });

  it("무회전 오프셋: 빈틈이 생기지 않는 범위로 자른다", () => {
    // scale 1: 가로 여유 (400-200)/2=100, 세로 여유 0
    const t = clampTransform(
      { x: 999, y: 9, scale: 1, rotation: 0 },
      photo,
      rect,
    );
    expect(t.x).toBe(100);
    expect(t.y).toBeCloseTo(0);
    const t2 = clampTransform(
      { x: -999, y: -9, scale: 1, rotation: 0 },
      photo,
      rect,
    );
    expect(t2.x).toBe(-100);
    expect(t2.y).toBeCloseTo(0);
  });

  it("90° 회전 오프셋: 로컬 축 기준으로 자른다", () => {
    // 90°/scale 1: 사진 400축이 캔버스 세로(rect 300)를 덮어 여유 50,
    // 사진 300축이 캔버스 가로(rect 200)를 덮어 여유 50 → 양방향 ±50
    const t = clampTransform(
      { x: 999, y: 999, scale: 1, rotation: Math.PI / 2 },
      photo,
      rect,
    );
    expect(t.x).toBeCloseTo(50);
    expect(t.y).toBeCloseTo(50);
  });
});

describe("zoomAt", () => {
  it("기준점을 고정한 채 확대한다 (슬롯 중심 좌표계)", () => {
    const start = initialTransform(photo, rect);
    const focus = { x: 100, y: 150 }; // rect 중앙 → 중심 좌표 (0,0)
    const zoomed = zoomAt(start, 2, focus, photo, rect);
    expect(zoomed.scale).toBe(2);
    expect(zoomed.x).toBeCloseTo(0); // 중앙 기준 확대 → 오프셋 불변
    expect(zoomed.y).toBeCloseTo(0);
  });

  it("모서리 기준 확대는 오프셋이 반대로 밀리고 클램프된다", () => {
    const start = initialTransform(photo, rect);
    const zoomed = zoomAt(start, 2, { x: 0, y: 0 }, photo, rect); // 좌상단 기준
    expect(zoomed.scale).toBe(2);
    expect(zoomed.x).toBeCloseTo(100); // (−100,−150) 기준 2배 → 중심이 (+100,+150) 방향, 클램프 내
    expect(zoomed.y).toBeCloseTo(150);
  });

  it("하한(각도별 cover) 아래 축소만 막는다", () => {
    const start = initialTransform(photo, rect);
    const under = zoomAt(start, 0.01, { x: 0, y: 0 }, photo, rect);
    expect(under.scale).toBe(1);
    expect(under.x).toBe(0);
    const over = zoomAt(start, 100, { x: 100, y: 150 }, photo, rect);
    expect(over.scale).toBe(100); // 상한 없음
  });
});

describe("snapAngle / rotateTo", () => {
  it("90° 배수 ±3° 안이면 스냅, 밖이면 그대로", () => {
    expect(snapAngle(2 * DEG)).toBe(0);
    expect(snapAngle(88 * DEG)).toBeCloseTo(90 * DEG);
    expect(snapAngle(-91 * DEG)).toBeCloseTo(-90 * DEG);
    expect(snapAngle(10 * DEG)).toBeCloseTo(10 * DEG);
    expect(SNAP_THRESHOLD).toBeCloseTo(3 * DEG);
  });

  it("회전하면 부족한 배율만큼 자동 확대된다", () => {
    const start = initialTransform(photo, rect); // scale 1
    const rotated = rotateTo(start, 45 * DEG, photo, rect);
    expect(rotated.rotation).toBeCloseTo(45 * DEG);
    expect(rotated.scale).toBeCloseTo(minScaleFor(photo, rect, 45 * DEG));
    expect(rotated.scale).toBeGreaterThan(1);
  });

  it("회전을 되돌려도 자동 축소하지 않는다 (사용자 배율 존중)", () => {
    const start = initialTransform(photo, rect);
    const rotated = rotateTo(start, 45 * DEG, photo, rect);
    const back = rotateTo(rotated, 0, photo, rect);
    expect(back.rotation).toBe(0);
    expect(back.scale).toBeCloseTo(rotated.scale); // 유지
  });

  it("스냅과 결합: 88° 입력 → 90° 확정 + 90° 기준 배율", () => {
    const start = initialTransform(photo, rect);
    const rotated = rotateTo(start, 88 * DEG, photo, rect);
    expect(rotated.rotation).toBeCloseTo(90 * DEG);
    expect(rotated.scale).toBeCloseTo(1); // 90°에서 minScale 0.75 < 기존 1 → 유지
  });
});

describe("composeTransform / toZoom", () => {
  it("오프셋이 없으면 중앙, 배율 = minScale(θ)×zoom — 비율 전환 시 확대감 유지의 근거", async () => {
    const { composeTransform } = await import("./transform");
    expect(composeTransform(null, 1, 0, photo, rect)).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    });
    const zoomed = composeTransform(null, 2, 0, photo, rect);
    expect(zoomed.scale).toBe(2); // cover×2
    const rotated = composeTransform(null, 1.5, 45 * DEG, photo, rect);
    expect(rotated.scale).toBeCloseTo(minScaleFor(photo, rect, 45 * DEG) * 1.5);
  });

  it("zoom 1 미만은 cover로 방어하고, 오프셋은 클램프된다", async () => {
    const { composeTransform } = await import("./transform");
    const t = composeTransform({ x: 999, y: 0 }, 0.5, 0, photo, rect);
    expect(t.scale).toBe(1); // zoom<1 → cover
    expect(t.x).toBe(100); // 가로 여유 한계로 클램프
  });

  it("toZoom은 변환에서 공유 줌을 역산한다 (compose와 왕복 일치)", async () => {
    const { composeTransform, toZoom } = await import("./transform");
    const t = composeTransform(null, 1.8, 30 * DEG, photo, rect);
    expect(toZoom(t, photo, rect)).toBeCloseTo(1.8);
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
