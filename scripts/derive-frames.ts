/**
 * v2 레이어 시안(docs/design/frames/<프레임명>/) → 런타임 에셋(public/frames) + 템플릿 JSON 파생.
 *
 * 실행: node scripts/derive-frames.ts
 * 규약: docs/specs/01-template-schema.md — v2 폴더가 있는 프레임만 재생성한다.
 */
import {
  existsSync,
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
  detectCornerRadius,
  diffRatio,
  dilateMask,
  downscaleBy,
  eraseMask,
  extractSlotRegions,
  fillMaskToGray,
  semiTransparentMask,
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
  /**
   * 슬롯 레이어 번호(NN, 1부터) 명시. 디자인 자체가 선명한 단색을 쓰는 프레임은
   * 자동 탐지("채움 있는 레이어 1장")가 모호해진다 — Accent의 layer01 빨간 배경처럼
   * 배경색이 채움으로 오인되는 경우 여기로 슬롯 레이어를 지정한다
   */
  slotLayer?: number;
  /** 사용 예시 파일명 오버라이드 (기본 `<dir>_sample.png`) — 명명 편차 수용용 */
  sampleName?: string;
  /** sample_gray 파일명 오버라이드 (기본 `<dir>_<변형>_sample_gray.png`) */
  sampleGrayName?: (variant: VariantId) => string;
}

const FRAME_CONFIGS: FrameConfig[] = [
  {
    id: "duo",
    name: "Duo",
    order: 1,
    dir: "Duo",
    slots: [
      { id: "left", label: "왼쪽 사진" },
      { id: "right", label: "오른쪽 사진" },
    ],
  },
  {
    id: "punching",
    name: "Punching",
    order: 2,
    dir: "Punching",
    // v2에서 디자인 교체 (사용자 확인 2026-08-07): 구 main/stars 폐기 —
    // 상하 반반 2칸, 하늘색 별 오버레이(위 칸은 별 구멍으로 사진이 비침)
    slots: [
      { id: "top", label: "위 사진" },
      { id: "bottom", label: "아래 사진" },
    ],
    // layer02(하늘색 별 오버레이)가 채움으로 오인되므로 슬롯 레이어 명시
    slotLayer: 1,
  },
  {
    id: "accent",
    name: "Accent",
    order: 3,
    dir: "Accent",
    slots: [
      { id: "top", label: "위 사진" },
      { id: "bottom", label: "아래 사진" },
    ],
    // layer01의 빨강(214,0,0)은 상단 배경색이지 슬롯 채움이 아니다 — layer02가 슬롯 레이어
    slotLayer: 2,
  },
  {
    id: "weeklydump",
    name: "Weekly Dump",
    order: 4,
    dir: "Weeklydump",
    // 7칸 각기 다른 색, 읽기 순서 = 윗줄 4칸 → 아랫줄 3칸. 라운드 코너 → radius 검출 대상
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
    id: "doodle",
    name: "Doodle",
    order: 5,
    dir: "Doodle",
    slots: [{ id: "main", label: "사진" }],
    // layer03(낙서 스트로크)의 진초록(8,90,7)이 채움으로 오인되므로 슬롯 레이어 명시
    slotLayer: 2,
  },
  {
    id: "fourleafclover",
    name: "Fourleafclover",
    order: 6,
    dir: "Fourleafclover",
    slots: [
      { id: "top", label: "위 사진" },
      { id: "bottom", label: "아래 사진" },
    ],
    // layer02(네온 클로버 오버레이)가 채움으로 오인되므로 슬롯 레이어 명시
    slotLayer: 1,
  },
  // 나머지 프레임: 한 프레임씩 확인하며 추가 (기존 v1 산출물은 그대로 유지)
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
  // sample_gray는 QA 기준(자동 회귀)으로만 쓴다 — 없으면 회귀만 건너뛴다 (스펙 01)
  const sampleGrayPath = path.join(
    DESIGN_DIR,
    config.dir,
    config.sampleGrayName?.(variant) ??
      `${config.dir}_${variant}_sample_gray.png`,
  );
  const sampleGray = existsSync(sampleGrayPath)
    ? readPng(sampleGrayPath)
    : null;

  const { width, height } = layers[0];
  for (const img of sampleGray ? [...layers, sampleGray] : layers) {
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

  // 슬롯 레이어 결정 — 명시(slotLayer)가 없으면 채움 영역이 나오는 레이어가 정확히 1장이어야 한다
  let slotLayerIndex: number;
  if (config.slotLayer !== undefined) {
    slotLayerIndex = config.slotLayer - 1;
    if (slotLayerIndex < 0 || slotLayerIndex >= layers.length) {
      throw new Error(
        `${config.id}/${variant}: slotLayer ${config.slotLayer}가 레이어 수(${layers.length}) 범위 밖`,
      );
    }
  } else {
    const withFills = layers
      .map((layer, i) => (extractSlotRegions(layer).length > 0 ? i : -1))
      .filter((i) => i >= 0);
    if (withFills.length !== 1) {
      throw new Error(
        `${config.id}/${variant}: 슬롯 채움이 있는 레이어가 ${withFills.length}장 — 설정에 slotLayer 명시 필요`,
      );
    }
    slotLayerIndex = withFills[0];
  }
  const slotLayer = layers[slotLayerIndex];
  const regions = extractSlotRegions(slotLayer);
  if (regions.length !== config.slots.length) {
    throw new Error(
      `${config.id}/${variant}: 채움 색 ${regions.length}개 != 슬롯 ${config.slots.length}개`,
    );
  }

  // 크롬 = 슬롯 레이어에서 채움을 파낸 것. AA 잡색 제거를 위해 배율 px(1080 기준 1px)만 팽창 —
  // base가 이제 아래층(layer01)이라 과팽창하면 그 자리에 배경이 비쳐 테두리가 얇아진다 (스펙 01)
  const fillMask = buildFillMask(
    slotLayer,
    regions.map((r) => r.color),
  );
  const chrome = eraseMask(
    slotLayer,
    dilateMask(fillMask, width, height, factor),
  );
  // overlay = 크롬 + 슬롯 레이어 위층들 합성
  const overlayFull = layers
    .slice(slotLayerIndex + 1)
    .reduce((acc, layer) => compositeOver(acc, layer), chrome);

  // base = 슬롯 레이어 아래층 합성 — 회색 자리표시는 굽지 않는다 (코드가 그린다, 스펙 01)
  const emptyCanvas = (): RawImage => ({
    width,
    height,
    data: new Uint8Array(width * height * 4),
  });
  const baseFull = layers
    .slice(0, slotLayerIndex)
    .reduce((acc, layer) => compositeOver(acc, layer), emptyCanvas());
  const base = downscaleBy(baseFull, factor);
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
    // 분류 사다리: 완전 사각 → 둥근 사각(radius) → 자유 형상(mask) (스펙 01·03)
    if (region.isRect) return { slot: slot.id, rect, fit: "cover" as const };
    const radiusFull = detectCornerRadius(slotLayer, region.color, region);
    if (radiusFull !== null) {
      return {
        slot: slot.id,
        rect,
        radius: Math.round(radiusFull / factor),
        fit: "cover" as const,
      };
    }
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

  // 자동 회귀 (수용 기준 4): 런타임 z-순서 그대로 base + 회색 자리표시 + overlay를 합성하면
  // 디자이너의 sample_gray가 나와야 한다 — 좌표 오배치·층 분해 오류를 빌드 시점에 잡는다.
  // 회색은 채움 마스크 그대로 칠해(축소로 가장자리 소프트닝) 코드 자리표시를 재현한다
  if (sampleGray) {
    const grayImg = downscaleBy(
      fillMaskToGray(fillMask, width, height),
      factor,
    );
    const rebuilt = compositeOver(compositeOver(base, grayImg), overlay);
    // overlay 반투명 가장자리는 합성 순서 차이(디자이너: 원본 해상도 합성 후 축소 vs
    // 우리: 축소 후 합성)로 잡음이 낀다 — 판정 제외 (오배치는 불투명·투명 영역에서 잡힘)
    const ratio = diffRatio(
      rebuilt,
      downscaleBy(sampleGray, factor),
      8,
      semiTransparentMask(overlay),
    );
    if (ratio > MAX_DIFF_RATIO) {
      throw new Error(
        `${config.id}/${variant}: 합성 회귀 실패 — sample_gray 불일치율 ${(ratio * 100).toFixed(2)}% > ${MAX_DIFF_RATIO * 100}%`,
      );
    }
    console.log(
      `${config.id}/${variant}: 합성 회귀 통과 (불일치율 ${(ratio * 100).toFixed(3)}%)`,
    );
  } else {
    console.warn(
      `${config.id}/${variant}: sample_gray 없음 — 합성 회귀 건너뜀 (디자이너에게 요청 권장)`,
    );
  }

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
    path.join(
      DESIGN_DIR,
      config.dir,
      config.sampleName ?? `${config.dir}_sample.png`,
    ),
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
