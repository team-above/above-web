/**
 * 내보내기 보조 로직 — 스펙 04. 래스터화 자체는 EditorCanvas의 exportRef가 담당한다.
 */
import type { SlotPhoto } from "@/stores/editor";
import type { VariantId } from "@/templates/schema";

/** 다운로드 파일명: above-{frameId}-{variant}.png */
export function exportFileName(frameId: string, variant: VariantId): string {
  return `above-${frameId}-${variant}.png`;
}

/** 다운로드 가능 조건 = 사진 1장 이상 (사용자 확정 2026-07-28) */
export function canExport(photos: Record<string, SlotPhoto>): boolean {
  return Object.keys(photos).length > 0;
}
