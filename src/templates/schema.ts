/**
 * 프레임 템플릿 JSON 스키마 타입과 로드 시 검증.
 * 규약: docs/specs/01-template-schema.md — 템플릿은 코드가 아니라 데이터다.
 */

export type VariantId = "post" | "story";

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TemplateSlot {
  id: string;
  label: string;
}

export interface TemplatePlacement {
  slot: string;
  rect: Rect;
  /** 둥근 사각 슬롯의 모서리 반지름(캔버스 px) — 클립·자리표시에 사용 (스펙 01) */
  radius?: number;
  /** 자유 형상 슬롯 전용 — 없으면 렌더러가 rect(+radius) 클립으로 처리한다 (스펙 01) */
  mask?: string;
  fit: "cover";
}

export interface TemplateVariant {
  canvas: Size;
  assets: { base: string; overlay: string };
  slots: TemplateSlot[];
  placements: TemplatePlacement[];
}

export interface FrameTemplate {
  id: string;
  name: string;
  order: number;
  /** 홈 카드 미리보기 (사용 예시 시안 축소본) */
  preview: string;
  variants: Record<VariantId, TemplateVariant>;
}

export class TemplateValidationError extends Error {}

function fail(id: string, message: string): never {
  throw new TemplateValidationError(`템플릿 "${id}" 검증 실패: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRect(value: unknown): value is Rect {
  return (
    isRecord(value) &&
    ["x", "y", "width", "height"].every(
      (k) =>
        typeof value[k] === "number" && Number.isFinite(value[k] as number),
    )
  );
}

function validateVariant(
  id: string,
  variantId: string,
  value: unknown,
): TemplateVariant {
  if (!isRecord(value)) fail(id, `variants.${variantId}가 객체가 아님`);
  const { canvas, assets, slots, placements } =
    value as Partial<TemplateVariant>;
  if (
    !isRecord(canvas) ||
    typeof canvas.width !== "number" ||
    typeof canvas.height !== "number"
  ) {
    fail(id, `${variantId}.canvas 형식 오류`);
  }
  if (
    !isRecord(assets) ||
    typeof assets.base !== "string" ||
    typeof assets.overlay !== "string"
  ) {
    fail(id, `${variantId}.assets 형식 오류 (base/overlay 경로 필요)`);
  }
  if (!Array.isArray(slots) || slots.length === 0) {
    fail(id, `${variantId}.slots가 비어 있음`);
  }
  const slotIds = new Set<string>();
  for (const slot of slots) {
    if (
      !isRecord(slot) ||
      typeof slot.id !== "string" ||
      typeof slot.label !== "string"
    ) {
      fail(id, `${variantId}.slots 항목 형식 오류`);
    }
    if (slotIds.has(slot.id)) fail(id, `${variantId} 슬롯 id 중복: ${slot.id}`);
    slotIds.add(slot.id);
  }
  if (!Array.isArray(placements) || placements.length === 0) {
    fail(id, `${variantId}.placements가 비어 있음`);
  }
  for (const placement of placements) {
    if (!isRecord(placement))
      fail(id, `${variantId}.placements 항목 형식 오류`);
    if (typeof placement.slot !== "string" || !slotIds.has(placement.slot)) {
      fail(
        id,
        `${variantId} placement가 존재하지 않는 슬롯 참조: ${String(placement.slot)}`,
      );
    }
    if (!isRect(placement.rect))
      fail(id, `${variantId} placement.rect 형식 오류`);
    if (placement.mask !== undefined && typeof placement.mask !== "string")
      fail(id, `${variantId} placement.mask는 경로 문자열이어야 함`);
    if (
      placement.radius !== undefined &&
      (typeof placement.radius !== "number" ||
        !Number.isFinite(placement.radius) ||
        placement.radius < 0)
    )
      fail(id, `${variantId} placement.radius는 0 이상 숫자여야 함`);
    if (placement.fit !== "cover")
      fail(id, `${variantId} placement.fit은 "cover"만 지원`);
  }
  const placedSlots = new Set(
    placements.map((p) => (p as TemplatePlacement).slot),
  );
  for (const slotId of slotIds) {
    if (!placedSlots.has(slotId))
      fail(id, `${variantId} 슬롯 "${slotId}"의 placement 없음`);
  }
  return value as unknown as TemplateVariant;
}

/** JSON에서 로드한 템플릿을 검증한다. 위반 시 TemplateValidationError */
export function validateTemplate(data: unknown): FrameTemplate {
  if (!isRecord(data))
    throw new TemplateValidationError("템플릿이 객체가 아님");
  const id = typeof data.id === "string" ? data.id : "(id 없음)";
  if (typeof data.id !== "string" || data.id.length === 0) fail(id, "id 필요");
  if (typeof data.name !== "string" || data.name.length === 0)
    fail(id, "name 필요");
  if (typeof data.order !== "number") fail(id, "order 필요");
  if (typeof data.preview !== "string" || data.preview.length === 0) {
    fail(id, "preview 경로 필요");
  }
  if (!isRecord(data.variants)) fail(id, "variants 필요");
  for (const variantId of ["post", "story"] as const) {
    validateVariant(id, variantId, data.variants[variantId]);
  }
  return data as unknown as FrameTemplate;
}
