/**
 * 시안 PNG → 런타임 에셋 파생을 위한 순수 로직.
 * 픽셀 데이터는 RGBA 평면 배열(RawImage)로만 다루고 파일 IO는 scripts/derive-frames.ts가 담당한다.
 * 규약: docs/specs/01-template-schema.md
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

export interface Component {
  /** 라벨 맵에서의 성분 번호 (1부터) */
  label: number;
  bbox: Rect;
  area: number;
  cx: number;
  cy: number;
}

/** 자리표시 회색 판정 임계값 — 무채색이며 밝기 중간 대역(그라디언트 포함, 흰 배경·검정 텍스트 제외) */
export const PLACEHOLDER = {
  lumMin: 140,
  lumMax: 238,
  chromaMax: 14,
} as const;

export function isPlaceholder(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min > PLACEHOLDER.chromaMax) return false;
  const lum = (r + g + b) / 3;
  return lum >= PLACEHOLDER.lumMin && lum <= PLACEHOLDER.lumMax;
}

/** 2×2 평균으로 정확히 절반 크기로 축소한다 (파생 해상도 = 내보내기 규격) */
export function downscaleHalf(img: RawImage): RawImage {
  const w = Math.floor(img.width / 2);
  const h = Math.floor(img.height / 2);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = img.data[(2 * y * img.width + 2 * x) * 4 + c];
        const b = img.data[(2 * y * img.width + 2 * x + 1) * 4 + c];
        const d = img.data[((2 * y + 1) * img.width + 2 * x) * 4 + c];
        const e = img.data[((2 * y + 1) * img.width + 2 * x + 1) * 4 + c];
        out[o + c] = Math.round((a + b + d + e) / 4);
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** 픽셀별 자리표시 여부 (0/1) */
export function detectPlaceholderMask(img: RawImage): Uint8Array {
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    if (isPlaceholder(img.data[o], img.data[o + 1], img.data[o + 2])) {
      mask[i] = 1;
    }
  }
  return mask;
}

export interface ComponentResult {
  /** 픽셀별 성분 번호 (0 = 자리표시 아님) */
  labels: Int32Array;
  components: Component[];
}

/** 4-연결 성분 분석. minArea 미만 성분(안티앨리어싱 노이즈)은 버린다 */
export function findComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea = 30,
): ComponentResult {
  const labels = new Int32Array(width * height);
  const components: Component[] = [];
  let next = 0;
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1 || labels[start] !== 0) continue;
    next += 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;
    stack.push(start);
    labels[start] = next;
    while (stack.length > 0) {
      const idx = stack.pop() as number;
      const x = idx % width;
      const y = Math.floor(idx / width);
      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[idx - 1] === 1 && labels[idx - 1] === 0) {
        labels[idx - 1] = next;
        stack.push(idx - 1);
      }
      if (x < width - 1 && mask[idx + 1] === 1 && labels[idx + 1] === 0) {
        labels[idx + 1] = next;
        stack.push(idx + 1);
      }
      if (y > 0 && mask[idx - width] === 1 && labels[idx - width] === 0) {
        labels[idx - width] = next;
        stack.push(idx - width);
      }
      if (
        y < height - 1 &&
        mask[idx + width] === 1 &&
        labels[idx + width] === 0
      ) {
        labels[idx + width] = next;
        stack.push(idx + width);
      }
    }
    if (area >= minArea) {
      components.push({
        label: next,
        area,
        bbox: {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        },
        cx: sumX / area,
        cy: sumY / area,
      });
    }
  }
  return { labels, components };
}

/** 마스크를 radius px 팽창시킨다 — 자리표시 경계의 안티앨리어싱 헤일로 제거용 */
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

/** 자리표시 픽셀을 투명 처리한 오버레이를 만든다 */
export function buildOverlay(img: RawImage, mask: Uint8Array): RawImage {
  const data = new Uint8Array(img.data);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) data[i * 4 + 3] = 0;
  }
  return { width: img.width, height: img.height, data };
}

export function unionBbox(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 성분 집합을 bbox 기준으로 잘라낸 불투명 흰색 마스크 PNG 데이터를 만든다 */
export function buildSlotMask(
  labels: Int32Array,
  imageWidth: number,
  componentLabels: number[],
  bbox: Rect,
): RawImage {
  const wanted = new Set(componentLabels);
  const data = new Uint8Array(bbox.width * bbox.height * 4);
  for (let y = 0; y < bbox.height; y++) {
    for (let x = 0; x < bbox.width; x++) {
      const src = (bbox.y + y) * imageWidth + (bbox.x + x);
      if (wanted.has(labels[src])) {
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

/** 성분들을 행(세로 근접) → 열(x) 순으로 정렬한다. frame01/03/04처럼 순서 기반 슬롯 매핑에 사용 */
export function sortComponentsByRow(
  components: Component[],
  imageHeight: number,
): Component[] {
  const rowGap = imageHeight * 0.05;
  const sorted = [...components].sort((a, b) => a.cy - b.cy);
  const rows: Component[][] = [];
  for (const comp of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(comp.cy - row[row.length - 1].cy) < rowGap) {
      row.push(comp);
    } else {
      rows.push([comp]);
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.cx - b.cx));
}
