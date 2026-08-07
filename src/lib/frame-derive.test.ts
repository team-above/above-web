import { describe, expect, it } from "vitest";
import {
  buildFillMask,
  detectCornerRadius,
  fillMaskToGray,
  buildSlotMask,
  compositeOver,
  diffRatio,
  dilateMask,
  downscaleBy,
  eraseMask,
  extractSlotRegions,
  fillRects,
  sortRegionsByReadingOrder,
  type RawImage,
  type SlotRegion,
} from "./frame-derive";

/** 문자 → RGBA 매핑으로 테스트 이미지를 만든다 (" " = 투명) */
function makeImage(
  rows: string[],
  palette: Record<string, [number, number, number, number?]>,
): RawImage {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const [r, g, b, a = 255] = palette[ch];
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    });
  });
  return { width, height, data };
}

const PALETTE: Record<string, [number, number, number, number?]> = {
  " ": [0, 0, 0, 0], // 투명 배경
  R: [255, 0, 0], // 슬롯 채움 1 (임의의 선명한 색)
  G: [26, 255, 0], // 슬롯 채움 2
  k: [33, 26, 26], // 크롬 (테두리 — 무채색에 가까움)
  s: [0, 0, 0, 120], // 반투명 그림자
  h: [255, 128, 128, 128], // 채움 색 경계의 반투명 AA — 채움으로 세면 안 됨
};

describe("extractSlotRegions", () => {
  it("선명한 단색 채움을 색별로 그룹핑하고 읽기 순서로 반환한다", () => {
    // 10×4: 왼쪽 R 사각형, 오른쪽 G 사각형 (면적 조건: 8/40 = 20% ≥ 0.2%)
    const img = makeImage(
      ["          ", " RR   GG  ", " RR   GG  ", "          "],
      PALETTE,
    );
    const regions = extractSlotRegions(img);
    expect(regions).toHaveLength(2);
    expect(regions[0].color).toEqual({ r: 255, g: 0, b: 0 }); // 왼쪽 먼저
    expect(regions[1].color).toEqual({ r: 26, g: 255, b: 0 });
    expect(regions[0].bbox).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(regions[0].isRect).toBe(true);
    expect(regions[0].fillRatio).toBe(1);
  });

  it("무채색(크롬)·반투명(그림자·AA) 픽셀은 채움으로 세지 않는다", () => {
    const img = makeImage(["kkkk", "hRRs", "hRRs", "kkkk"], PALETTE);
    const regions = extractSlotRegions(img);
    expect(regions).toHaveLength(1);
    expect(regions[0].area).toBe(4); // R 4픽셀만
  });

  it("같은 색의 떨어진 조각들은 하나의 슬롯(합집합 bbox)이 된다", () => {
    const img = makeImage(["R R", "   ", "R R"], PALETTE);
    const regions = extractSlotRegions(img);
    expect(regions).toHaveLength(1);
    expect(regions[0].bbox).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(regions[0].isRect).toBe(false); // 채움비 4/9
  });

  it("면적이 기준(0.2%) 미만인 색은 버린다", () => {
    // 40×40 = 1600픽셀, 기준 3.2픽셀 — R 2픽셀은 잡색으로 무시
    const rows = Array.from({ length: 40 }, (_, y) =>
      y === 0 ? "RR" + " ".repeat(38) : " ".repeat(40),
    );
    expect(extractSlotRegions(makeImage(rows, PALETTE))).toHaveLength(0);
  });
});

describe("sortRegionsByReadingOrder", () => {
  it("행(세로 근접) → 열(x) 순으로 정렬한다", () => {
    const region = (cx: number, cy: number): SlotRegion => ({
      color: { r: 0, g: 0, b: 0 },
      area: 1,
      bbox: { x: cx, y: cy, width: 1, height: 1 },
      fillRatio: 1,
      isRect: true,
      cx,
      cy,
    });
    const sorted = sortRegionsByReadingOrder(
      [region(1, 40), region(7, 0), region(3, 1)],
      100, // rowGap = 5 — cy 0과 1은 같은 행
    );
    expect(sorted.map((r) => [r.cx, r.cy])).toEqual([
      [3, 1],
      [7, 0],
      [1, 40],
    ]);
  });
});

describe("buildFillMask / eraseMask", () => {
  it("채움 색 픽셀만 파내 크롬을 남긴다", () => {
    const img = makeImage(["kR", "sG"], PALETTE);
    const mask = buildFillMask(img, [{ r: 255, g: 0, b: 0 }]);
    expect([...mask]).toEqual([0, 1, 0, 0]); // R만
    const chrome = eraseMask(img, mask);
    expect(chrome.data[1 * 4 + 3]).toBe(0); // R → 투명
    expect(chrome.data[0 * 4 + 3]).toBe(255); // 크롬 유지
    expect(chrome.data[2 * 4 + 3]).toBe(120); // 반투명 그림자 유지
    expect(img.data[1 * 4 + 3]).toBe(255); // 원본 불변
  });

  it("반투명 픽셀은 색이 같아도 채움이 아니다", () => {
    const img = makeImage(["h"], PALETTE); // 반투명 AA
    const mask = buildFillMask(img, [{ r: 255, g: 128, b: 128 }]);
    expect([...mask]).toEqual([0]);
  });
});

describe("dilateMask", () => {
  it("마스크를 1px 팽창시키고 원본은 유지한다", () => {
    const mask = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const dilated = dilateMask(mask, 3, 3, 1);
    expect([...dilated]).toEqual([0, 1, 0, 1, 1, 1, 0, 1, 0]); // 십자 팽창(4-연결)
    expect([...mask]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]); // 원본 불변
  });
});

describe("compositeOver", () => {
  it("알파를 반영해 위층을 아래층에 얹는다", () => {
    const bottom = makeImage(["R"], PALETTE);
    const top = makeImage(["s"], PALETTE); // 검정 47% 그림자
    const out = compositeOver(bottom, top);
    // 255 * (1 - 120/255) ≈ 135
    expect(out.data[0]).toBe(135);
    expect(out.data[3]).toBe(255);
  });

  it("투명 픽셀은 아래층을 그대로 둔다", () => {
    const bottom = makeImage(["G"], PALETTE);
    const top = makeImage([" "], PALETTE);
    const out = compositeOver(bottom, top);
    expect([...out.data]).toEqual([26, 255, 0, 255]);
  });

  it("크기가 다르면 에러를 던진다", () => {
    expect(() =>
      compositeOver(makeImage(["R"], PALETTE), makeImage(["RR"], PALETTE)),
    ).toThrow(/크기 불일치/);
  });
});

describe("downscaleBy", () => {
  it("정수 배율 박스 평균으로 축소한다", () => {
    const img = makeImage(["RR  ", "RR  ", "    ", "    "], PALETTE);
    const half = downscaleBy(img, 2);
    expect(half.width).toBe(2);
    expect(half.height).toBe(2);
    expect(half.data[0]).toBe(255); // 좌상단 = R 블록
    expect(half.data[3]).toBe(255);
    expect(half.data[7]).toBe(0); // 우상단 = 투명
  });

  it("배율 1은 원본과 같다", () => {
    const img = makeImage(["RG"], PALETTE);
    expect(downscaleBy(img, 1).data).toEqual(img.data);
  });

  it("비정수 배율은 에러를 던진다", () => {
    expect(() => downscaleBy(makeImage(["R"], PALETTE), 1.5)).toThrow(
      /정수여야/,
    );
  });
});

describe("buildSlotMask", () => {
  it("채움 색 + 팽창 반경이 흰색 마스크가 된다 (비사각 슬롯)", () => {
    const img = makeImage(["    ", " R  ", "    "], PALETTE);
    const mask = buildSlotMask(
      img,
      { r: 255, g: 0, b: 0 },
      { x: 0, y: 0, width: 4, height: 3 },
      1,
    );
    const alphaAt = (x: number, y: number) => mask.data[(y * 4 + x) * 4 + 3];
    expect(alphaAt(1, 1)).toBe(255); // 채움
    expect(alphaAt(0, 1)).toBe(255); // 팽창 1px
    expect(alphaAt(3, 0)).toBe(0); // 바깥
  });
});

describe("detectCornerRadius", () => {
  const RED = { r: 255, g: 0, b: 0 };
  /** 반지름 r의 둥근 사각형 채움 이미지 생성 */
  function roundedImage(w: number, h: number, r: number): RawImage {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const cx = Math.max(r, Math.min(w - r, px));
        const cy = Math.max(r, Math.min(h - r, py));
        if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) {
          const o = (y * w + x) * 4;
          data[o] = 255;
          data[o + 3] = 255;
        }
      }
    }
    return { width: w, height: h, data };
  }

  it("둥근 사각형 채움에서 반지름을 복원한다", () => {
    const img = roundedImage(60, 40, 8);
    const [region] = extractSlotRegions(img);
    const r = detectCornerRadius(img, RED, region);
    expect(r).not.toBeNull();
    expect(Math.abs(r! - 8)).toBeLessThan(1.5);
  });

  it("완전 사각형(결손 없음)은 null", () => {
    const img = makeImage(["RRR", "RRR"], PALETTE);
    const [region] = extractSlotRegions(img);
    expect(detectCornerRadius(img, RED, region)).toBeNull();
  });

  it("둥근 사각형이 아닌 형상(십자)은 기각한다", () => {
    // 40×40 십자 — 모서리 결손이 크지만 원호 모양이 아니다
    const rows = Array.from({ length: 40 }, (_, y) => {
      const arm = y >= 12 && y < 28;
      return Array.from({ length: 40 }, (_, x) =>
        arm || (x >= 12 && x < 28) ? "R" : " ",
      ).join("");
    });
    const img = makeImage(rows, PALETTE);
    const [region] = extractSlotRegions(img);
    expect(detectCornerRadius(img, RED, region)).toBeNull();
  });
});

describe("fillMaskToGray", () => {
  it("마스크 픽셀만 불투명 회색이 된다", () => {
    const gray = fillMaskToGray(new Uint8Array([1, 0]), 2, 1);
    expect([...gray.data]).toEqual([217, 217, 217, 255, 0, 0, 0, 0]);
  });
});

describe("diffRatio / fillRects", () => {
  it("회색 rect를 채우고 불일치율을 잰다", () => {
    const a = makeImage(["kk", "kk"], PALETTE);
    const gray = fillRects(a, [{ x: 0, y: 0, width: 2, height: 1 }]);
    expect(gray.data[0]).toBe(217); // 회색 채움
    expect(gray.data[2 * 4]).toBe(33); // 아래 행은 유지
    expect(diffRatio(a, a)).toBe(0);
    expect(diffRatio(a, gray)).toBe(0.5); // 위 행 2/4 픽셀 불일치
  });

  it("크기가 다르면 전체 불일치(1)로 본다", () => {
    expect(
      diffRatio(makeImage(["k"], PALETTE), makeImage(["kk"], PALETTE)),
    ).toBe(1);
  });
});
