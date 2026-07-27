/**
 * 템플릿 로더 — JSON을 로드 시점에 검증해 제공한다 (스펙 01 수용 기준 5).
 * 새 템플릿 추가 = JSON·에셋 추가 + 여기 import 한 줄.
 */
import frame01 from "./frame01.json";
import frame02 from "./frame02.json";
import frame03 from "./frame03.json";
import frame04 from "./frame04.json";
import frame05 from "./frame05.json";
import frame06 from "./frame06.json";
import { validateTemplate, type FrameTemplate } from "./schema";

/** 원본 JSON 배열을 검증하고 order 오름차순으로 정렬한다. 검증 실패 시 throw */
export function loadTemplates(raw: unknown[]): FrameTemplate[] {
  return raw.map(validateTemplate).sort((a, b) => a.order - b.order);
}

export const templates: readonly FrameTemplate[] = loadTemplates([
  frame01,
  frame02,
  frame03,
  frame04,
  frame05,
  frame06,
]);

export function getTemplate(id: string): FrameTemplate | undefined {
  return templates.find((template) => template.id === id);
}
