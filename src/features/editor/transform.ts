/**
 * 슬롯 사진 배치 계산 — 스펙 03 "사진 조작" + 스펙 05 "자유 회전".
 * 순수 함수만. 좌표계: {x, y} = 사진 중심의 슬롯(rect) 중심 대비 오프셋(px),
 * scale = 원본 대비 배율, rotation = 라디안(사진 중심 기준).
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
  rotation: number;
}

/** 비율별로 독립 저장되는 조정값 — 회전은 사진 속성으로 비율 간 공유된다 (스펙 05 변경) */
export interface PlacementAdjust {
  x: number;
  y: number;
  scale: number;
}

/** 90° 자석 스냅 임계 (±3°) */
export const SNAP_THRESHOLD = (3 * Math.PI) / 180;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * 각도 θ로 회전한 사진이 rect를 덮는 데 필요한 최소 배율.
 * rect를 사진 로컬 축으로 투영한 반너비/반높이가 사진 반너비/반높이 이하가 되어야 한다.
 */
export function minScaleFor(photo: Size, rect: Size, rotation = 0): number {
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const projectedW = rect.width * cos + rect.height * sin;
  const projectedH = rect.width * sin + rect.height * cos;
  return Math.max(projectedW / photo.width, projectedH / photo.height);
}

/** 무회전 cover 배율 (minScaleFor의 θ=0 특수형 — 기존 호출부 호환) */
export function coverScale(photo: Size, rect: Size): number {
  return minScaleFor(photo, rect, 0);
}

/**
 * 변환을 불변식 안으로 강제한다.
 * 스케일 하한 = minScaleFor(θ), 오프셋은 사진 로컬 축으로 투영해 여유 범위 안으로 자른다.
 */
export function clampTransform(
  transform: PhotoTransform,
  photo: Size,
  rect: Size,
): PhotoTransform {
  const { rotation } = transform;
  const scale = Math.max(transform.scale, minScaleFor(photo, rect, rotation));

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // rect의 사진-로컬 투영 반너비/반높이
  const halfProjW =
    (rect.width * Math.abs(cos) + rect.height * Math.abs(sin)) / 2;
  const halfProjH =
    (rect.width * Math.abs(sin) + rect.height * Math.abs(cos)) / 2;
  // 사진 로컬 축에서 허용되는 오프셋 여유 (부동소수 오차 방어)
  const slackX = Math.max(0, (photo.width * scale) / 2 - halfProjW);
  const slackY = Math.max(0, (photo.height * scale) / 2 - halfProjH);
  // 오프셋을 로컬 축으로 회전 투영 → 클램프 → 되돌리기
  const localX = transform.x * cos + transform.y * sin;
  const localY = -transform.x * sin + transform.y * cos;
  const clampedX = clamp(localX, -slackX, slackX);
  const clampedY = clamp(localY, -slackY, slackY);
  return {
    scale,
    rotation,
    x: clampedX * cos - clampedY * sin,
    y: clampedX * sin + clampedY * cos,
  };
}

/** 초기 배치 = cover + 중앙 정렬 + 무회전 */
export function initialTransform(photo: Size, rect: Size): PhotoTransform {
  return { x: 0, y: 0, scale: coverScale(photo, rect), rotation: 0 };
}

/**
 * 비율별 조정값(없으면 중앙 cover) + 공유 회전을 합성해 항상 클램프된 변환을 만든다.
 * 비율 전환 직후처럼 조정값이 없거나 회전 대비 배율이 부족한 경우를 모두 흡수한다.
 */
export function composeTransform(
  adjust: PlacementAdjust | null,
  rotation: number,
  photo: Size,
  rect: Size,
): PhotoTransform {
  const base = adjust ?? { x: 0, y: 0, scale: 0 }; // scale 0 → 클램프가 minScale(θ)로 올린다
  return clampTransform({ ...base, rotation }, photo, rect);
}

/**
 * 기준점(focus, rect 좌상단 기준 좌표)을 고정한 채 배율을 factor배 조정한다 — 핀치/휠 줌.
 * 반환값은 항상 클램프되어 있다.
 */
export function zoomAt(
  transform: PhotoTransform,
  factor: number,
  focus: { x: number; y: number },
  photo: Size,
  rect: Size,
): PhotoTransform {
  const minScale = minScaleFor(photo, rect, transform.rotation);
  const nextScale = Math.max(transform.scale * factor, minScale);
  const ratio = nextScale / transform.scale;
  // focus를 슬롯 중심 기준으로 변환
  const fx = focus.x - rect.width / 2;
  const fy = focus.y - rect.height / 2;
  return clampTransform(
    {
      ...transform,
      scale: nextScale,
      x: fx + (transform.x - fx) * ratio,
      y: fy + (transform.y - fy) * ratio,
    },
    photo,
    rect,
  );
}

/** 90° 배수 근처(±SNAP_THRESHOLD)면 자석 스냅 */
export function snapAngle(rotation: number): number {
  const quarter = Math.PI / 2;
  const nearest = Math.round(rotation / quarter) * quarter;
  return Math.abs(rotation - nearest) <= SNAP_THRESHOLD ? nearest : rotation;
}

/**
 * 절대 각도로 회전한다 — 스냅 적용 후, 부족해지는 배율은 자동 확대(축소는 하지 않음).
 */
export function rotateTo(
  transform: PhotoTransform,
  rotation: number,
  photo: Size,
  rect: Size,
): PhotoTransform {
  const snapped = snapAngle(rotation);
  const scale = Math.max(transform.scale, minScaleFor(photo, rect, snapped));
  return clampTransform(
    { ...transform, rotation: snapped, scale },
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
