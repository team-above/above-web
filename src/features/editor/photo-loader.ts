"use client";

import type { SlotPhoto } from "@/stores/editor";
import { decodeTargetSize } from "./transform";

export class PhotoLoadError extends Error {}

/**
 * 사용자 파일 → 슬롯 사진 비트맵.
 * EXIF 회전 보정 + 대형 사진 다운샘플(최장변 2160px) — 스펙 03 엣지 케이스.
 */
export async function loadPhoto(file: File): Promise<SlotPhoto> {
  if (!file.type.startsWith("image/")) {
    throw new PhotoLoadError("이미지 파일만 넣을 수 있어요");
  }
  let decoded: ImageBitmap;
  try {
    decoded = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoLoadError("사진을 읽지 못했어요. 다른 파일로 시도해 주세요");
  }
  const target = decodeTargetSize({
    width: decoded.width,
    height: decoded.height,
  });
  if (target.width === decoded.width) {
    return { bitmap: decoded, fileName: file.name };
  }
  const resized = await createImageBitmap(decoded, {
    resizeWidth: target.width,
    resizeHeight: target.height,
    resizeQuality: "high",
  });
  decoded.close();
  return { bitmap: resized, fileName: file.name };
}
