/** 인스타그램 규격에 맞춘 내보내기 캔버스 크기 */
export type AspectMode = "post" | "story";

export interface Size {
  width: number;
  height: number;
}

export const EXPORT_SIZES: Record<AspectMode, Size> = {
  post: { width: 1080, height: 1350 }, // 4:5
  story: { width: 1080, height: 1920 }, // 9:16
};

/**
 * 내보내기 캔버스를 비율 유지한 채 뷰포트 안에 맞추는 스케일과 표시 크기를 계산한다.
 * 에디터 미리보기 스테이지 크기 결정에 사용.
 */
export function fitToViewport(
  mode: AspectMode,
  viewport: Size,
): Size & { scale: number } {
  const target = EXPORT_SIZES[mode];
  const scale = Math.min(
    viewport.width / target.width,
    viewport.height / target.height,
  );
  return {
    scale,
    width: target.width * scale,
    height: target.height * scale,
  };
}
