"use client";

import { useEffect, useState } from "react";

/** 같은 오리진 에셋 이미지를 로드한다 (base/overlay/mask). src가 없으면 로드하지 않는다 */
export function useImageElement(
  src: string | undefined,
): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const el = new window.Image();
    el.onload = () => {
      if (!cancelled) setImage(el);
    };
    el.onerror = () => {
      // 마스크/오버레이 로드 실패 시 사진을 마스크 없이 노출하지 않도록 null 유지
      console.error("에셋 이미지를 불러오지 못했어요:", src);
    };
    el.src = src;
    return () => {
      cancelled = true;
      setImage(null);
    };
  }, [src]);
  return image;
}
