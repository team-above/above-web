/**
 * 슬롯 사진 배치 계산 — 스펙 03 "사진 조작".
 * 순수 함수만: 좌표계는 placement rect 원점 기준, {x, y} = 사진 좌상단 오프셋(px), scale = 원본 대비 배율.
 * 불변식: 사진이 rect를 항상 빈틈 없이 덮는다 (cover). 확대 상한은 없다 (기획 확정 2026-07-28).
 */

export interface Size {
  width: number;
  height: number;
}

export interface PhotoTransform {
  x: number;
  y: number;
  scale: number;
}

/** rect를 빈틈 없이 채우는 최소 배율 */
export function coverScale(photo: Size, rect: Size): number {
  return Math.max(rect.width / photo.width, rect.height / photo.height);
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * 변환을 불변식 안으로 강제한다.
 * 스케일 하한 = cover(빈틈 금지), 상한 없음(기획 확정 2026-07-28).
 * 오프셋은 사진 경계가 rect 안쪽으로 들어오지 않는 범위.
 */
export function clampTransform(
  transform: PhotoTransform,
  photo: Size,
  rect: Size,
): PhotoTransform {
  const minScale = coverScale(photo, rect);
  const scale = Math.max(transform.scale, minScale);
  const width = photo.width * scale;
  const height = photo.height * scale;
  return {
    scale,
    x: clamp(transform.x, rect.width - width, 0),
    y: clamp(transform.y, rect.height - height, 0),
  };
}

/** 초기 배치 = cover + 중앙 정렬 */
export function initialTransform(photo: Size, rect: Size): PhotoTransform {
  const scale = coverScale(photo, rect);
  return {
    scale,
    x: (rect.width - photo.width * scale) / 2,
    y: (rect.height - photo.height * scale) / 2,
  };
}

/**
 * 기준점(focus, rect 좌표계)을 고정한 채 배율을 factor배 조정한다 — 핀치/휠 줌.
 * 반환값은 항상 클램프되어 있다.
 */
export function zoomAt(
  transform: PhotoTransform,
  factor: number,
  focus: { x: number; y: number },
  photo: Size,
  rect: Size,
): PhotoTransform {
  const minScale = coverScale(photo, rect);
  const nextScale = Math.max(transform.scale * factor, minScale);
  const ratio = nextScale / transform.scale;
  return clampTransform(
    {
      scale: nextScale,
      x: focus.x - (focus.x - transform.x) * ratio,
      y: focus.y - (focus.y - transform.y) * ratio,
    },
    photo,
    rect,
  );
}

/** 대형 사진 디코딩 시 다운샘플 목표 크기 — 최장변 상한(기본 2160px, 내보내기 규격의 2배) */
export function decodeTargetSize(photo: Size, maxEdge = 2160): Size {
  const longest = Math.max(photo.width, photo.height);
  if (longest <= maxEdge) return photo;
  const ratio = maxEdge / longest;
  return {
    width: Math.round(photo.width * ratio),
    height: Math.round(photo.height * ratio),
  };
}
