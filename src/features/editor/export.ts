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

/**
 * iOS에서만 시스템 공유 시트로 저장한다 (기획 확정 2026-07-29) — iOS의 앵커 다운로드는
 * 갤러리가 아닌 파일 앱/미리보기로 가서 "저장 안 됨"으로 체감된다. 공유 시트에는
 * "이미지 저장"(갤러리)이 있다. Android·데스크톱은 앵커 다운로드가 곧 즉시 저장.
 * iPadOS 13+는 UA가 Macintosh로 위장하므로 터치 지점 수로 구분한다.
 */
export function shouldUseShareSheet(
  userAgent: string,
  maxTouchPoints: number,
  canShareFiles: boolean,
): boolean {
  const isIos =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  return isIos && canShareFiles;
}

/**
 * data URL → Blob 동기 변환. iOS의 navigator.share는 사용자 제스처와 같은 태스크에서
 * 불러야 해서(transient activation), 비동기 toBlob 대신 동기 toDataURL 경로를 쓴다.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
