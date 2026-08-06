/**
 * v2 레이어 시안(docs/design/frames/<프레임명>/) → 런타임 에셋(public/frames) + 템플릿 JSON 파생.
 *
 * 실행: node scripts/derive-frames.ts
 * 규약: docs/specs/01-template-schema.md — v2 폴더가 있는 프레임만 재생성한다.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import sharp from "sharp";
import {
  buildFillMask,
  buildSlotMask,
  compositeOver,
  diffRatio,
  dilateMask,
  downscaleBy,
  eraseMask,
  extractSlotRegions,
  fillRects,
  type RawImage,
  type SlotRegion,
} from "../src/lib/frame-derive.ts";
import type {
  FrameTemplate,
  TemplatePlacement,
  TemplateVariant,
  VariantId,
} from "../src/templates/schema.ts";
import { validateTemplate } from "../src/templates/schema.ts";

const ROOT = path.join(import.meta.dirname, "..");
const DESIGN_DIR = path.join(ROOT, "docs/design/frames");
const PUBLIC_DIR = path.join(ROOT, "public/frames");
const TEMPLATE_DIR = path.join(ROOT, "src/templates");

/** 좌표계 = 내보내기 규격 가로폭. 시안은 이 값의 정수배여야 한다 */
const TARGET_WIDTH = 1080;
/** 합성 자동 회귀 허용 불일치율 (스펙 01 수용 기준 4) — 가장자리 AA만 있으면 0.1% 안팎 */
const MAX_DIFF_RATIO = 0.005;

interface FrameConfig {
  id: string;
  name: string;
  order: number;
  /** docs/design/frames 하위 폴더명 (= 파일명 접두어) */
  dir: string;
  /** 읽기 순서(위→아래, 왼→오른쪽)로 슬롯 id를 매핑한다 */
  slots: { id: string; label: string }[];
}

const FRAME_CONFIGS: FrameConfig[] = [
  {
    id: "frame01",
    name: "Duo",
    order: 1,
    dir: "Duo",
    slots: [
      { id: "left", label: "왼쪽 사진" },
      { id: "right", label: "오른쪽 사진" },
    ],
  },
  // frame02~06: 디자이너 v2 에셋 수령 후 추가 (기존 v1 산출물은 그대로 유지)
];

function readPng(filePath: string): RawImage {
  const png = PNG.sync.read(readFileSync(filePath));
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data),
  };
}

function writePng(filePath: string, image: RawImage): void {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  writeFileSync(filePath, PNG.sync.write(png));
}

/** base/overlay/preview는 WebP로 저장 — 모바일 로딩 용량 절감 (마스크는 PNG 유지) */
async function writeWebp(filePath: string, image: RawImage): Promise<void> {
  await sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .webp({ quality: 82 })
    .toFile(filePath);
}

/** `<dir>_<variant>_layerNN.png`를 NN 오름차순(아래→위)으로 읽는다 */
function readLayers(config: FrameConfig, variant: VariantId): RawImage[] {
  const dir = path.join(DESIGN_DIR, config.dir);
  const pattern = new RegExp(`^${config.dir}_${variant}_layer(\\d+)\\.png$`);
  const files = readdirSync(dir)
    .map((name) => ({ name, match: pattern.exec(name) }))
    .filter((f) => f.match)
    .sort((a, b) => Number(a.match![1]) - Number(b.match![1]));
  if (files.length === 0) {
    throw new Error(`${config.id}/${variant}: 레이어 파일 없음 (${dir})`);
  }
  return files.map((f) => readPng(path.join(dir, f.name)));
}

async function deriveVariant(
  config: FrameConfig,
  variant: VariantId,
): Promise<TemplateVariant> {
  const layers = readLayers(config, variant);
  const sampleGray = readPng(
    path.join(
      DESIGN_DIR,
      config.dir,
      `${config.dir}_${variant}_sample_gray.png`,
    ),
  );

  const { width, height } = layers[0];
  for (const img of [...layers, sampleGray]) {
    if (img.width !== width || img.height !== height) {
      throw new Error(
        `${config.id}/${variant}: 파일 크기 불일치 (${img.width}×${img.height} vs ${width}×${height})`,
      );
    }
  }
  const factor = width / TARGET_WIDTH;
  if (!Number.isInteger(factor)) {
    throw new Error(
      `${config.id}/${variant}: 가로폭 ${width}는 ${TARGET_WIDTH}의 정수배가 아님`,
    );
  }

  // 슬롯 레이어 탐지 — 채움 영역이 나오는 레이어가 정확히 1장이어야 한다
  const extracted = layers.map((layer) => extractSlotRegions(layer));
  const slotLayerIndices = extracted
    .map((regions, i) => (regions.length > 0 ? i : -1))
    .filter((i) => i >= 0);
  if (slotLayerIndices.length !== 1) {
    throw new Error(
      `${config.id}/${variant}: 슬롯 채움이 있는 레이어가 ${slotLayerIndices.length}장 (정확히 1장이어야 함)`,
    );
  }
  const slotLayerIndex = slotLayerIndices[0];
  const slotLayer = layers[slotLayerIndex];
  const regions = extracted[slotLayerIndex];
  if (regions.length !== config.slots.length) {
    throw new Error(
      `${config.id}/${variant}: 채움 색 ${regions.length}개 != 슬롯 ${config.slots.length}개`,
    );
  }

  // 크롬 = 슬롯 레이어에서 채움을 파낸 것. AA 잡색 제거를 위해 2×배율 px 과팽창 —
  // base(sample_gray)가 같은 크롬을 갖고 있어 더 파내도 안전하다 (스펙 01)
  const fillMask = buildFillMask(
    slotLayer,
    regions.map((r) => r.color),
  );
  const chrome = eraseMask(
    slotLayer,
    dilateMask(fillMask, width, height, 2 * factor),
  );
  // overlay = 크롬 + 슬롯 레이어 위층들 합성
  const overlayFull = layers
    .slice(slotLayerIndex + 1)
    .reduce((acc, layer) => compositeOver(acc, layer), chrome);

  const base = downscaleBy(sampleGray, factor);
  const overlay = downscaleBy(overlayFull, factor);

  const outDir = path.join(PUBLIC_DIR, config.id, variant);
  mkdirSync(outDir, { recursive: true });
  await writeWebp(path.join(outDir, "base.webp"), base);
  await writeWebp(path.join(outDir, "overlay.webp"), overlay);

  const placements: TemplatePlacement[] = config.slots.map((slot, i) => {
    const region = regions[i];
    const rect = {
      x: Math.round(region.bbox.x / factor),
      y: Math.round(region.bbox.y / factor),
      width: Math.round(region.bbox.width / factor),
      height: Math.round(region.bbox.height / factor),
    };
    // 사각 슬롯은 마스크 생략 — 렌더러가 rect 클립으로 처리 (스펙 01·03)
    if (region.isRect) return { slot: slot.id, rect, fit: "cover" as const };
    const mask = downscaleBy(
      buildSlotMask(
        slotLayer,
        region.color,
        {
          x: rect.x * factor,
          y: rect.y * factor,
          width: rect.width * factor,
          height: rect.height * factor,
        },
        factor,
      ),
      factor,
    );
    writePng(path.join(outDir, `mask-${slot.id}.png`), mask);
    return {
      slot: slot.id,
      rect,
      mask: `/frames/${config.id}/${variant}/mask-${slot.id}.png`,
      fit: "cover" as const,
    };
  });

  // 자동 회귀 (수용 기준 4): 런타임 z-순서 그대로 base + 회색 rect(사진 대역) + overlay를
  // 합성하면 다시 sample_gray(=base)가 나와야 한다 — rect 오배치·overlay 크롬 어긋남을 잡는다
  const rebuilt = compositeOver(
    fillRects(
      base,
      placements.map((p) => p.rect),
    ),
    overlay,
  );
  const ratio = diffRatio(rebuilt, base);
  if (ratio > MAX_DIFF_RATIO) {
    throw new Error(
      `${config.id}/${variant}: 합성 회귀 실패 — sample_gray 불일치율 ${(ratio * 100).toFixed(2)}% > ${MAX_DIFF_RATIO * 100}%`,
    );
  }
  console.log(
    `${config.id}/${variant}: 합성 회귀 통과 (불일치율 ${(ratio * 100).toFixed(3)}%)`,
  );

  const describe = (regions as SlotRegion[])
    .map(
      (r, i) =>
        `${config.slots[i].id}=rgb(${r.color.r},${r.color.g},${r.color.b})${r.isRect ? "" : "·비사각"}`,
    )
    .join(", ");
  console.log(
    `${config.id}/${variant}: 레이어 ${layers.length}장(슬롯 레이어 #${slotLayerIndex + 1}) → ${describe} (${base.width}×${base.height})`,
  );

  return {
    canvas: { width: base.width, height: base.height },
    assets: {
      base: `/frames/${config.id}/${variant}/base.webp`,
      overlay: `/frames/${config.id}/${variant}/overlay.webp`,
    },
    slots: config.slots,
    placements,
  };
}

/** 사용 예시 시안(<dir>_sample.png) → 카드 미리보기 (스펙 02, 고DPR 대응 1080w) */
async function derivePreview(config: FrameConfig): Promise<string> {
  const sample = readPng(
    path.join(DESIGN_DIR, config.dir, `${config.dir}_sample.png`),
  );
  const factor = sample.width / TARGET_WIDTH;
  if (!Number.isInteger(factor)) {
    throw new Error(
      `${config.id}/preview: 가로폭 ${sample.width}는 ${TARGET_WIDTH}의 정수배가 아님`,
    );
  }
  const preview = downscaleBy(sample, factor);
  const outDir = path.join(PUBLIC_DIR, config.id);
  mkdirSync(outDir, { recursive: true });
  await writeWebp(path.join(outDir, "preview.webp"), preview);
  console.log(`${config.id}/preview: ${preview.width}×${preview.height} 생성`);
  return `/frames/${config.id}/preview.webp`;
}

for (const config of FRAME_CONFIGS) {
  // 해당 프레임 산출물만 재생성 — v1 이행기의 다른 프레임 산출물은 건드리지 않는다
  rmSync(path.join(PUBLIC_DIR, config.id), { recursive: true, force: true });
  const template: FrameTemplate = {
    id: config.id,
    name: config.name,
    order: config.order,
    preview: await derivePreview(config),
    variants: {
      post: await deriveVariant(config, "post"),
      story: await deriveVariant(config, "story"),
    },
  };
  validateTemplate(template);
  writeFileSync(
    path.join(TEMPLATE_DIR, `${config.id}.json`),
    JSON.stringify(template, null, 2) + "\n",
  );
}
console.log("완료: 템플릿 JSON + 에셋 파생 생성");
