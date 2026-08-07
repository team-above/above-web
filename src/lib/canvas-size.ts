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
 * 내보내기 래스터 배율 (사용자 확정 2026-08-07) — 좌표계는 1080 그대로 두고 PNG만
 * 2배(2160×2700 / 2160×3840)로 굽는다. 갤러리 확대·재압축에 유리하다.
 * 사진 공급량(manageSourceResolution)과 @2x 프레임 에셋이 이 배율을 따라간다.
 */
export const EXPORT_PIXEL_RATIO = 2;

/**
 * 내보내기 캔버스를 비율 유지한 채 뷰포트 안에 맞추는 스케일과 표시 크기를 계산한다.
 * 에디터 미리보기 스테이지 크기 결정에 사용.
 *
 * 너비는 비율(post/story) 간 공통이다 (사용자 확정 2026-07-29): 두 비율 모두 뷰포트에
 * 들어가는 너비 중 작은 쪽(=세로가 긴 story의 fit 너비)으로 맞춰, 비율 전환 시 캔버스
 * 너비가 흔들리지 않는다. post는 그 너비에서 위아래 여백이 생긴다.
 */
export function fitToViewport(
  mode: AspectMode,
  viewport: Size,
): Size & { scale: number } {
  const target = EXPORT_SIZES[mode];
  // 모든 비율이 이 뷰포트에 들어가는 공통 스케일 (캔버스 너비 1080 공통 전제)
  const scale = Math.min(
    ...Object.values(EXPORT_SIZES).map((size) =>
      Math.min(viewport.width / size.width, viewport.height / size.height),
    ),
  );
  return {
    scale,
    width: target.width * scale,
    height: target.height * scale,
  };
}
