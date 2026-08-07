/**
 * v2 레이어 시안 → 런타임 에셋 파생을 위한 순수 로직.
 * 픽셀 데이터는 RGBA 평면 배열(RawImage)로만 다루고 파일 IO는 scripts/derive-frames.ts가 담당한다.
 * 규약: docs/specs/01-template-schema.md — 슬롯은 슬롯 레이어의 "선명한 단색 채움"으로 선언된다.
 */

export interface RawImage {
  width: number;
  height: number;
  /** RGBA, 길이 = width * height * 4 */
  data: Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 슬롯 레이어에서 추출한 한 슬롯의 채움 영역 (같은 색 = 같은 슬롯) */
export interface SlotRegion {
  color: Rgb;
  /** 채움 픽셀 수 */
  area: number;
  bbox: Rect;
  /** area / bbox 넓이 — 1에 가까우면 순수 사각형 */
  fillRatio: number;
  /** 사각 슬롯 여부 (마스크 없이 rect 클립 가능) */
  isRect: boolean;
  /** 채움 무게중심 — 읽기 순서 정렬용 */
  cx: number;
  cy: number;
}

/** 슬롯 채움 판정 규약 — 스펙 01 "선명한 단색, 캔버스의 0.2% 이상" */
export const SLOT_FILL = {
  /** max(r,g,b) − min(r,g,b) 최소값 — 무채색(테두리·그림자·텍스트) 제외 */
  chromaMin: 60,
  /** 캔버스 대비 최소 면적 비율 — AA 잡색 제외 */
  minAreaRatio: 0.002,
  /** 이 채움비 이상이면 사각 슬롯으로 취급 */
  rectFillMin: 0.995,
} as const;

function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * 슬롯 레이어에서 슬롯 채움 영역들을 추출한다.
 * 완전 불투명 && 채도 ≥ chromaMin 픽셀을 정확한 RGB로 그룹핑하고,
 * 면적 기준을 넘는 색만 슬롯으로 인정해 읽기 순서(위→아래, 왼→오른쪽)로 반환한다.
 */
export function extractSlotRegions(img: RawImage): SlotRegion[] {
  const { width, height, data } = img;
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 255) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (chroma(r, g, b) < SLOT_FILL.chromaMin) continue;
    const key = (r << 16) | (g << 8) | b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const minArea = width * height * SLOT_FILL.minAreaRatio;
  const slotKeys = new Set(
    [...counts.entries()].filter(([, n]) => n >= minArea).map(([k]) => k),
  );

  const stats = new Map<
    number,
    {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      sumX: number;
      sumY: number;
      area: number;
    }
  >();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (data[o + 3] !== 255) continue;
      const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
      if (!slotKeys.has(key)) continue;
      let s = stats.get(key);
      if (!s) {
        s = { minX: x, minY: y, maxX: x, maxY: y, sumX: 0, sumY: 0, area: 0 };
        stats.set(key, s);
      }
      if (x < s.minX) s.minX = x;
      if (x > s.maxX) s.maxX = x;
      if (y < s.minY) s.minY = y;
      if (y > s.maxY) s.maxY = y;
      s.sumX += x;
      s.sumY += y;
      s.area += 1;
    }
  }

  const regions: SlotRegion[] = [...stats.entries()].map(([key, s]) => {
    const bbox = {
      x: s.minX,
      y: s.minY,
      width: s.maxX - s.minX + 1,
      height: s.maxY - s.minY + 1,
    };
    const fillRatio = s.area / (bbox.width * bbox.height);
    return {
      color: { r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255 },
      area: s.area,
      bbox,
      fillRatio,
      isRect: fillRatio >= SLOT_FILL.rectFillMin,
      cx: s.sumX / s.area,
      cy: s.sumY / s.area,
    };
  });
  return sortRegionsByReadingOrder(regions, height);
}

/** 영역들을 행(세로 근접) → 열(x) 순으로 정렬한다 — 슬롯 순서 = 읽기 순서 규약 */
export function sortRegionsByReadingOrder(
  regions: SlotRegion[],
  imageHeight: number,
): SlotRegion[] {
  const rowGap = imageHeight * 0.05;
  const sorted = [...regions].sort((a, b) => a.cy - b.cy);
  const rows: SlotRegion[][] = [];
  for (const region of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(region.cy - row[row.length - 1].cy) < rowGap) {
      row.push(region);
    } else {
      rows.push([region]);
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.cx - b.cx));
}

/** 슬롯 채움 색들과 정확히 일치하는 불투명 픽셀 마스크 (0/1) */
export function buildFillMask(img: RawImage, colors: Rgb[]): Uint8Array {
  const keys = new Set(colors.map((c) => (c.r << 16) | (c.g << 8) | c.b));
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    if (img.data[o + 3] !== 255) continue;
    const key = (img.data[o] << 16) | (img.data[o + 1] << 8) | img.data[o + 2];
    if (keys.has(key)) mask[i] = 1;
  }
  return mask;
}

/** 마스크를 radius px 팽창시킨다 — 채움 경계의 안티앨리어싱 잡색 제거용 */
export function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius = 1,
): Uint8Array {
  let current = mask;
  for (let step = 0; step < radius; step++) {
    const out = new Uint8Array(current);
    for (let i = 0; i < current.length; i++) {
      if (current[i] === 1) continue;
      const x = i % width;
      const y = Math.floor(i / width);
      if (
        (x > 0 && current[i - 1] === 1) ||
        (x < width - 1 && current[i + 1] === 1) ||
        (y > 0 && current[i - width] === 1) ||
        (y < height - 1 && current[i + width] === 1)
      ) {
        out[i] = 1;
      }
    }
    current = out;
  }
  return current;
}

/** 마스크 픽셀을 투명 처리한 사본을 만든다 — 슬롯 레이어에서 채움을 파내 크롬만 남길 때 사용 */
export function eraseMask(img: RawImage, mask: Uint8Array): RawImage {
  const data = new Uint8Array(img.data);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) data[i * 4 + 3] = 0;
  }
  return { width: img.width, height: img.height, data };
}

/** top을 bottom 위에 알파 합성(source-over)한다 — 위층 레이어들을 overlay로 합칠 때 사용 */
export function compositeOver(bottom: RawImage, top: RawImage): RawImage {
  if (bottom.width !== top.width || bottom.height !== top.height) {
    throw new Error(
      `레이어 크기 불일치: ${bottom.width}×${bottom.height} vs ${top.width}×${top.height}`,
    );
  }
  const data = new Uint8Array(bottom.data);
  for (let i = 0; i < data.length; i += 4) {
    const ta = top.data[i + 3] / 255;
    if (ta === 0) continue;
    const ba = data[i + 3] / 255;
    const outA = ta + ba * (1 - ta);
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.round(
        (top.data[i + c] * ta + data[i + c] * ba * (1 - ta)) / outA,
      );
    }
    data[i + 3] = Math.round(outA * 255);
  }
  return { width: bottom.width, height: bottom.height, data };
}

/** 정수 배율 박스 평균 다운스케일 — 파생 해상도 = 내보내기 규격 (1080 기준) */
export function downscaleBy(img: RawImage, factor: number): RawImage {
  if (!Number.isInteger(factor) || factor < 1) {
    throw new Error(`다운스케일 배율은 1 이상 정수여야 함: ${factor}`);
  }
  const w = Math.floor(img.width / factor);
  const h = Math.floor(img.height / factor);
  const out = new Uint8Array(w * h * 4);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) {
            sum +=
              img.data[
                ((y * factor + dy) * img.width + x * factor + dx) * 4 + c
              ];
          }
        }
        out[o + c] = Math.round(sum / n);
      }
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * 비사각 슬롯용 마스크 — bbox로 잘라낸 불투명 흰색 이미지.
 * 채움 색과 정확히 일치하는 픽셀 + radius 팽창(AA 경계 포함)이 마스크가 된다.
 */
export function buildSlotMask(
  img: RawImage,
  color: Rgb,
  bbox: Rect,
  radius = 1,
): RawImage {
  const fill = buildFillMask(img, [color]);
  const dilated = dilateMask(fill, img.width, img.height, radius);
  const data = new Uint8Array(bbox.width * bbox.height * 4);
  for (let y = 0; y < bbox.height; y++) {
    for (let x = 0; x < bbox.width; x++) {
      const srcX = bbox.x + x;
      const srcY = bbox.y + y;
      if (srcX >= img.width || srcY >= img.height) continue;
      if (dilated[srcY * img.width + srcX] === 1) {
        const o = (y * bbox.width + x) * 4;
        data[o] = 255;
        data[o + 1] = 255;
        data[o + 2] = 255;
        data[o + 3] = 255;
      }
    }
  }
  return { width: bbox.width, height: bbox.height, data };
}

/**
 * 둥근 사각형 슬롯 검출 — 채움 픽셀 집합이 "bbox + 균일 모서리 반지름"으로 설명되면
 * 반지름(px)을, 아니면 null을 반환한다. 반지름은 모서리 결손 면적((4−π)r²)에서 역산하고,
 * 실제 픽셀과 대조해 불일치가 AA 수준(둘레 비례)을 넘으면 기각한다.
 */
export function detectCornerRadius(
  img: RawImage,
  color: Rgb,
  region: SlotRegion,
): number | null {
  const { bbox, area } = region;
  const missing = bbox.width * bbox.height - area;
  if (missing <= 0) return null;
  const r = Math.sqrt(missing / (4 - Math.PI));
  // 반지름이 짧은 변의 절반을 넘으면 둥근 사각형 모델이 아니다
  if (r > Math.min(bbox.width, bbox.height) / 2 + 1) return null;
  const key = (c: number, x: number) => c === x;
  const inRounded = (x: number, y: number): boolean => {
    // bbox 로컬 좌표 (픽셀 중심 기준)
    const px = x + 0.5;
    const py = y + 0.5;
    const cx = Math.max(r, Math.min(bbox.width - r, px));
    const cy = Math.max(r, Math.min(bbox.height - r, py));
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  };
  let mismatch = 0;
  for (let y = 0; y < bbox.height; y++) {
    for (let x = 0; x < bbox.width; x++) {
      const o = ((bbox.y + y) * img.width + (bbox.x + x)) * 4;
      const filled =
        img.data[o + 3] === 255 &&
        key(img.data[o], color.r) &&
        key(img.data[o + 1], color.g) &&
        key(img.data[o + 2], color.b);
      if (filled !== inRounded(x, y)) mismatch++;
    }
  }
  // 허용 불일치 = 둘레 1px 밴드(AA) 수준
  const perimeter = 2 * (bbox.width + bbox.height);
  return mismatch <= perimeter ? r : null;
}

/** 채움 마스크(0/1)를 회색 자리표시 이미지로 변환 — 자동 회귀에서 코드 자리표시를 재현 */
export function fillMaskToGray(
  mask: Uint8Array,
  width: number,
  height: number,
  gray = 217,
): RawImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    const o = i * 4;
    data[o] = gray;
    data[o + 1] = gray;
    data[o + 2] = gray;
    data[o + 3] = 255;
  }
  return { width, height, data };
}

/**
 * 파생 결과 자동 회귀 (스펙 01 수용 기준 4) — 두 합성 결과의 픽셀 불일치율을 잰다.
 * 채널 차 tolerance 초과 픽셀의 비율을 반환한다 (가장자리 AA만 있으면 0.5% 미만).
 */
export function diffRatio(a: RawImage, b: RawImage, tolerance = 8): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let bad = 0;
  const total = a.width * a.height;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) > tolerance ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > tolerance ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > tolerance
    ) {
      bad++;
    }
  }
  return bad / total;
}

/** 회색 자리표시로 채운 사각형을 그린 사본 — 자동 회귀 합성용 */
export function fillRects(img: RawImage, rects: Rect[], gray = 217): RawImage {
  const data = new Uint8Array(img.data);
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        if (x < 0 || x >= img.width || y < 0 || y >= img.height) continue;
        const o = (y * img.width + x) * 4;
        data[o] = gray;
        data[o + 1] = gray;
        data[o + 2] = gray;
        data[o + 3] = 255;
      }
    }
  }
  return { width: img.width, height: img.height, data };
}
