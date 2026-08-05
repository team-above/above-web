"use client";

import type { SlotPhoto } from "@/stores/editor";
import { decodeTargetSize } from "./transform";

export class PhotoLoadError extends Error {}

/**
 * 사용자 파일 → 슬롯 사진 비트맵.
 * EXIF 회전 보정 + 대형 사진 다운샘플(최장변 2160px) — 스펙 03 엣지 케이스.
 *
 * 원본 파일과 원본 크기를 함께 들고 있는다: 크게 확대하면 2160px로는 화질이 모자라,
 * 편집이 끝난 뒤 필요한 배율만큼 원본을 다시 디코딩해 교체한다 (스펙 03 성능 노트).
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
  const sourceSize = { width: decoded.width, height: decoded.height };
  const target = decodeTargetSize(sourceSize);
  if (target.width === decoded.width) {
    return { bitmap: decoded, fileName: file.name, file, sourceSize };
  }
  const resized = await createImageBitmap(decoded, {
    resizeWidth: target.width,
    resizeHeight: target.height,
    resizeQuality: "high",
  });
  decoded.close();
  return { bitmap: resized, fileName: file.name, file, sourceSize };
}
