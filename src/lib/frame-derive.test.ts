import { describe, expect, it } from "vitest";
import {
  buildOverlay,
  buildSlotMask,
  detectPlaceholderMask,
  downscaleHalf,
  findComponents,
  isPlaceholder,
  sortComponentsByRow,
  unionBbox,
  type RawImage,
} from "./frame-derive";

/** 단색 픽셀 배열로 테스트 이미지를 만든다. 문자 → 색 매핑 */
function makeImage(
  rows: string[],
  palette: Record<string, [number, number, number]>,
): RawImage {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const [r, g, b] = palette[ch];
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    });
  });
  return { width, height, data };
}

const PALETTE: Record<string, [number, number, number]> = {
  ".": [255, 255, 255], // 흰 배경
  "#": [217, 217, 217], // 자리표시 회색 (#D9D9D9)
  g: [168, 168, 168], // 그라디언트 어두운 회색
  B: [27, 42, 74], // 남색 (디자인 요소)
  t: [10, 10, 10], // 검정 텍스트
};

describe("isPlaceholder", () => {
  it("자리표시 회색과 그라디언트 대역을 판정한다", () => {
    expect(isPlaceholder(217, 217, 217)).toBe(true);
    expect(isPlaceholder(168, 168, 168)).toBe(true);
  });

  it("흰 배경·검정 텍스트·유채색 디자인 요소는 제외한다", () => {
    expect(isPlaceholder(255, 255, 255)).toBe(false);
    expect(isPlaceholder(10, 10, 10)).toBe(false);
    expect(isPlaceholder(27, 42, 74)).toBe(false); // 남색
    expect(isPlaceholder(173, 224, 251)).toBe(false); // 하늘색
  });
});

describe("downscaleHalf", () => {
  it("2×2 블록 평균으로 절반 크기가 된다", () => {
    const img = makeImage(["##..", "##..", "....", "...."], PALETTE);
    const half = downscaleHalf(img);
    expect(half.width).toBe(2);
    expect(half.height).toBe(2);
    expect(half.data[0]).toBe(217); // 좌상단 = 회색 블록 평균
    expect(half.data[4]).toBe(255); // 우상단 = 흰색
  });
});

describe("findComponents", () => {
  const rows = ["##..##", "##..##", "......", "######", "######", "######"];

  it("분리된 자리표시 영역을 성분으로 나눈다", () => {
    const img = makeImage(rows, PALETTE);
    const mask = detectPlaceholderMask(img);
    const { components } = findComponents(mask, img.width, img.height, 1);
    expect(components).toHaveLength(3);
    const areas = components.map((c) => c.area).sort((a, b) => a - b);
    expect(areas).toEqual([4, 4, 18]);
  });

  it("minArea 미만 노이즈는 버린다", () => {
    const img = makeImage(rows, PALETTE);
    const mask = detectPlaceholderMask(img);
    const { components } = findComponents(mask, img.width, img.height, 10);
    expect(components).toHaveLength(1);
    expect(components[0].bbox).toEqual({ x: 0, y: 3, width: 6, height: 3 });
  });
});

describe("buildOverlay", () => {
  it("자리표시 픽셀만 투명 처리하고 나머지는 유지한다", () => {
    const img = makeImage(["#B", ".t"], PALETTE);
    const overlay = buildOverlay(img, detectPlaceholderMask(img));
    expect(overlay.data[3]).toBe(0); // 회색 → 투명
    expect(overlay.data[7]).toBe(255); // 남색 유지
    expect(overlay.data[11]).toBe(255); // 흰색 유지
    expect(overlay.data[15]).toBe(255); // 검정 유지
  });
});

describe("buildSlotMask / unionBbox", () => {
  it("성분 집합의 합집합 bbox로 잘라낸 마스크를 만든다", () => {
    const img = makeImage(["##..##", "##..##"], PALETTE);
    const mask = detectPlaceholderMask(img);
    const { labels, components } = findComponents(
      mask,
      img.width,
      img.height,
      1,
    );
    const bbox = unionBbox(components.map((c) => c.bbox));
    expect(bbox).toEqual({ x: 0, y: 0, width: 6, height: 2 });
    const slotMask = buildSlotMask(
      labels,
      img.width,
      components.map((c) => c.label),
      bbox,
    );
    expect(slotMask.data[3]).toBe(255); // (0,0) 별 영역 = 불투명
    expect(slotMask.data[2 * 4 + 3]).toBe(0); // (2,0) 사이 공백 = 투명
    expect(slotMask.data[4 * 4 + 3]).toBe(255); // (4,0) 두 번째 별 = 불투명
  });
});

describe("dilateMask", () => {
  it("마스크를 1px 팽창시키고 원본은 유지한다", async () => {
    const { dilateMask } = await import("./frame-derive");
    // 3×3 중앙 1픽셀
    const mask = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const dilated = dilateMask(mask, 3, 3, 1);
    expect([...dilated]).toEqual([0, 1, 0, 1, 1, 1, 0, 1, 0]); // 십자 팽창(4-연결)
    expect([...mask]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]); // 원본 불변
  });
});

describe("sortComponentsByRow", () => {
  it("행(세로 근접) → 열(x) 순으로 정렬한다", () => {
    const rows = ["..##..##", "........", "........", "........", "##......"];
    const img = makeImage(rows, PALETTE);
    const mask = detectPlaceholderMask(img);
    const { components } = findComponents(mask, img.width, img.height, 1);
    const sorted = sortComponentsByRow(components, img.height);
    expect(sorted.map((c) => [Math.round(c.cx), Math.round(c.cy)])).toEqual([
      [3, 0],
      [7, 0],
      [1, 4],
    ]);
  });
});
