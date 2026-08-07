"use client";

import type { SlotPhoto } from "@/stores/editor";
import { decodeTargetSize } from "./transform";

export class PhotoLoadError extends Error {}

/**
 * 점진 반감 계획 — 원본 폭에서 목표 폭까지 "2배씩" 줄이는 중간 단계 폭 목록.
 * 브라우저의 단일 패스 리사이즈(drawImage·createImageBitmap resize)는 축소 배율이 2배를
 * 크게 넘으면 원본 픽셀을 건너뛰며 샘플링해 에일리어싱이 생긴다(실측: 13배 축소에서
 * 엣지 에너지 151 vs 점진 반감 33 vs 이상적 29 — 2026-08-07). 마지막 단계(≤2배)는 호출부가
 * 목표 크기로 직접 그린다.
 */
export function downscaleSteps(
  srcWidth: number,
  targetWidth: number,
): number[] {
  const steps: number[] = [];
  let width = srcWidth;
  while (width / 2 > targetWidth) {
    width = Math.round(width / 2);
    steps.push(width);
  }
  return steps;
}

/** 비트맵을 점진 반감으로 목표 크기까지 고품질 축소한다. 원본은 닫지 않는다 */
export async function downscaleBitmap(
  source: ImageBitmap,
  targetWidth: number,
  targetHeight: number,
): Promise<ImageBitmap> {
  let current: ImageBitmap | HTMLCanvasElement = source;
  for (const width of downscaleSteps(source.width, targetWidth)) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round((width * source.height) / source.width);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(current, 0, 0, canvas.width, canvas.height);
    current = canvas;
  }
  const final = document.createElement("canvas");
  final.width = targetWidth;
  final.height = targetHeight;
  const ctx = final.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(current, 0, 0, targetWidth, targetHeight);
  return createImageBitmap(final);
}

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
