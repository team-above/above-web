/**
 * 시안 PNG(docs/design/frames) → 런타임 에셋(public/frames) + 템플릿 JSON(src/templates) 파생.
 *
 * 실행: node scripts/derive-frames.ts
 * 규약: docs/specs/01-template-schema.md — 시안 교체 시 이 스크립트만 다시 돌리면 된다.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import sharp from "sharp";
import {
  buildOverlay,
  buildSlotMask,
  detectPlaceholderMask,
  dilateMask,
  downscaleHalf,
  findComponents,
  sortComponentsByRow,
  unionBbox,
  type Component,
  type RawImage,
} from "../src/lib/frame-derive.ts";
import type {
  FrameTemplate,
  TemplateVariant,
  VariantId,
} from "../src/templates/schema.ts";
import { validateTemplate } from "../src/templates/schema.ts";

const ROOT = path.join(import.meta.dirname, "..");
const DESIGN_DIR = path.join(ROOT, "docs/design/frames");
const PUBLIC_DIR = path.join(ROOT, "public/frames");
const TEMPLATE_DIR = path.join(ROOT, "src/templates");

interface FrameConfig {
  id: string;
  name: string;
  order: number;
  slots: { id: string; label: string }[];
  /** 성분 → 슬롯 그룹핑. 기본은 행→열 정렬 후 슬롯 순서와 1:1 매핑 */
  assign?: (
    components: Component[],
    image: RawImage,
  ) => Map<string, Component[]>;
}

const FRAME_CONFIGS: FrameConfig[] = [
  {
    id: "frame01",
    name: "Duo",
    order: 1,
    slots: [
      { id: "left", label: "왼쪽 사진" },
      { id: "right", label: "오른쪽 사진" },
    ],
  },
  {
    id: "frame02",
    name: "Punching",
    order: 2,
    slots: [
      { id: "stars", label: "별 사진" },
      { id: "main", label: "메인 사진" },
    ],
    // 최대 면적 성분 = 하단 메인, 나머지 별무리 전체 = stars 슬롯 하나
    assign: (components) => {
      const main = components.reduce((a, b) => (b.area > a.area ? b : a));
      return new Map([
        ["stars", components.filter((c) => c !== main)],
        ["main", [main]],
      ]);
    },
  },
  {
    id: "frame03",
    name: "Accent",
    order: 3,
    slots: [
      { id: "top", label: "위 사진" },
      { id: "bottom", label: "아래 사진" },
    ],
  },
  {
    id: "frame04",
    name: "Weekly Dump",
    order: 4,
    slots: [
      { id: "mon", label: "Mon" },
      { id: "tue", label: "Tue" },
      { id: "wed", label: "Wed" },
      { id: "thu", label: "Thu" },
      { id: "fri", label: "Fri" },
      { id: "sat", label: "Sat" },
      { id: "sun", label: "Sun" },
    ],
  },
  {
    id: "frame05",
    name: "Doodle",
    order: 5,
    slots: [{ id: "main", label: "사진" }],
  },
  {
    id: "frame06",
    name: "Caption",
    order: 6,
    slots: [{ id: "main", label: "사진" }],
  },
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

async function deriveVariant(
  config: FrameConfig,
  variant: VariantId,
  suffix: string,
): Promise<TemplateVariant> {
  const sourceName = `Frame${config.id.slice(-2)}_${suffix}.png`;
  const original = readPng(path.join(DESIGN_DIR, sourceName));
  const image = downscaleHalf(original);

  const placeholderMask = detectPlaceholderMask(image);
  const { labels, components } = findComponents(
    placeholderMask,
    image.width,
    image.height,
    60,
  );

  let grouped: Map<string, Component[]>;
  if (config.assign) {
    grouped = config.assign(components, image);
  } else {
    const sorted = sortComponentsByRow(components, image.height);
    if (sorted.length !== config.slots.length) {
      throw new Error(
        `${config.id}/${variant}: 성분 ${sorted.length}개 != 슬롯 ${config.slots.length}개 — 임계값 조정 필요`,
      );
    }
    grouped = new Map(config.slots.map((slot, i) => [slot.id, [sorted[i]]]));
  }

  const outDir = path.join(PUBLIC_DIR, config.id, variant);
  mkdirSync(outDir, { recursive: true });
  await writeWebp(path.join(outDir, "base.webp"), image);
  // 오버레이는 경계 안티앨리어싱 헤일로 제거를 위해 1px 팽창한 마스크로 뚫는다
  await writeWebp(
    path.join(outDir, "overlay.webp"),
    buildOverlay(
      image,
      dilateMask(placeholderMask, image.width, image.height, 1),
    ),
  );

  const placements = config.slots.map((slot) => {
    const comps = grouped.get(slot.id);
    if (!comps || comps.length === 0) {
      throw new Error(
        `${config.id}/${variant}: 슬롯 "${slot.id}"에 배정된 성분 없음`,
      );
    }
    const bbox = unionBbox(comps.map((c) => c.bbox));
    const mask = buildSlotMask(
      labels,
      image.width,
      comps.map((c) => c.label),
      bbox,
    );
    writePng(path.join(outDir, `mask-${slot.id}.png`), mask);
    return {
      slot: slot.id,
      rect: bbox,
      mask: `/frames/${config.id}/${variant}/mask-${slot.id}.png`,
      fit: "cover" as const,
    };
  });

  console.log(
    `${config.id}/${variant}: ${components.length}개 성분 → ${config.slots.length}개 슬롯 (${image.width}×${image.height})`,
  );

  return {
    canvas: { width: image.width, height: image.height },
    assets: {
      base: `/frames/${config.id}/${variant}/base.webp`,
      overlay: `/frames/${config.id}/${variant}/overlay.webp`,
    },
    slots: config.slots,
    placements,
  };
}

/** 사용 예시 시안(SampleNN) → ¼ 축소 카드 미리보기 (스펙 02) */
async function derivePreview(config: FrameConfig): Promise<string> {
  const sample = readPng(
    path.join(DESIGN_DIR, `Sample${config.id.slice(-2)}.png`),
  );
  const preview = downscaleHalf(downscaleHalf(sample));
  const outDir = path.join(PUBLIC_DIR, config.id);
  mkdirSync(outDir, { recursive: true });
  await writeWebp(path.join(outDir, "preview.webp"), preview);
  console.log(`${config.id}/preview: ${preview.width}×${preview.height} 생성`);
  return `/frames/${config.id}/preview.webp`;
}

// 산출물 디렉터리는 매번 재생성 — 이전 포맷 잔재 제거
rmSync(PUBLIC_DIR, { recursive: true, force: true });

for (const config of FRAME_CONFIGS) {
  const template: FrameTemplate = {
    id: config.id,
    name: config.name,
    order: config.order,
    preview: await derivePreview(config),
    variants: {
      post: await deriveVariant(config, "post", "post"),
      story: await deriveVariant(config, "story", "story"),
    },
  };
  validateTemplate(template);
  writeFileSync(
    path.join(TEMPLATE_DIR, `${config.id}.json`),
    JSON.stringify(template, null, 2) + "\n",
  );
}
console.log("완료: 템플릿 JSON + 에셋 파생 생성");
