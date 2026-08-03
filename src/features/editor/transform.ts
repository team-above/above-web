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

/**
 * 슬롯 중앙에 오는 사진 지점(초점) — 사진 중심 기준, 무회전 사진 축, 사진 px 단위.
 * 줌·회전과 함께 사진 속성으로 비율 간 공유되어, 비율을 전환해도 같은 부분이 보인다 (스펙 06).
 */
export interface FocalPoint {
  x: number;
  y: number;
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
    // +0: 음의 0 정규화 (-scale×0 합성 경로에서 -0이 새어 나오지 않게)
    x: clampedX * cos - clampedY * sin + 0,
    y: clampedX * sin + clampedY * cos + 0,
  };
}

/** 초기 배치 = cover + 중앙 정렬 + 무회전 */
export function initialTransform(photo: Size, rect: Size): PhotoTransform {
  return { x: 0, y: 0, scale: coverScale(photo, rect), rotation: 0 };
}

/**
 * 공유 초점(없으면 중앙)·줌·회전을 합성해 항상 클램프된 변환을 만든다.
 * 실제 배율 = minScale(θ, rect) × zoom, 오프셋 = 초점이 슬롯 중앙에 오도록 역산 —
 * 비율 전환 시 같은 부분·확대감·각도가 그대로 유지된다 (스펙 06).
 * 슬롯 크기가 달라 초점을 정확히 지킬 수 없으면(사진 가장자리) 클램프가 최대한 근접시킨다.
 */
export function composeTransform(
  focal: FocalPoint | null,
  zoom: number,
  rotation: number,
  photo: Size,
  rect: Size,
): PhotoTransform {
  const scale = minScaleFor(photo, rect, rotation) * Math.max(zoom, 1);
  const f = focal ?? { x: 0, y: 0 };
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // 사진 지점 p의 화면 위치 = offset + scale·R(θ)·p → 초점을 슬롯 중앙(0,0)에 두는 offset
  const x = -scale * (f.x * cos - f.y * sin);
  const y = -scale * (f.x * sin + f.y * cos);
  return clampTransform({ x, y, scale, rotation }, photo, rect);
}

/** 변환에서 공유 초점을 역산한다 — 제스처 결과 저장용 (composeTransform과 왕복 일치) */
export function toFocal(transform: PhotoTransform): FocalPoint {
  const { x, y, scale, rotation } = transform;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: (-x * cos - y * sin) / scale,
    y: (x * sin - y * cos) / scale,
  };
}

/** 변환에서 공유 줌(cover 대비 상대 배율)을 역산한다 — 제스처 결과 저장용 */
export function toZoom(
  transform: PhotoTransform,
  photo: Size,
  rect: Size,
): number {
  return transform.scale / minScaleFor(photo, rect, transform.rotation);
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

/**
 * 두 손가락 제스처 — 확대/축소와 회전을 한 번에 적용한다 (기획 확정 2026-07-29).
 * 두 손가락 사이 중점(focus, rect 좌상단 기준)이 사진 위 같은 지점에 머물도록
 * 오프셋을 함께 회전·확대한다: t' = F + k·R(Δθ)·(t − F).
 *
 * `targetRotation`은 **증분이 아니라 절대 각도**다 — 제스처 중 누적한 원본 각도를 넘겨야
 * 한다. 증분마다 스냅을 걸면 한 프레임당 회전량(수 도)이 스냅 임계(±3°)를 못 벗어나
 * 매번 0으로 되돌아가 회전이 아예 안 걸린다.
 * 오프셋 보정에는 스냅 후 실제 적용된 각도차를 쓴다.
 */
export function pinchTransform(
  transform: PhotoTransform,
  factor: number,
  targetRotation: number,
  focus: { x: number; y: number },
  photo: Size,
  rect: Size,
): PhotoTransform {
  const rotation = snapAngle(targetRotation);
  const scale = Math.max(
    transform.scale * factor,
    minScaleFor(photo, rect, rotation),
  );
  const k = scale / transform.scale;
  const applied = rotation - transform.rotation; // 스냅 후 실제 각도차
  const cos = Math.cos(applied);
  const sin = Math.sin(applied);
  // focus를 슬롯 중심 기준으로 변환
  const fx = focus.x - rect.width / 2;
  const fy = focus.y - rect.height / 2;
  const dx = transform.x - fx;
  const dy = transform.y - fy;
  return clampTransform(
    {
      x: fx + k * (dx * cos - dy * sin),
      y: fy + k * (dx * sin + dy * cos),
      scale,
      rotation,
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
