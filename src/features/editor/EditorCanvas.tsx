"use client";

import KonvaLib from "konva";
import type Konva from "konva";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
} from "react-konva";
import { EXPORT_PIXEL_RATIO, fitToViewport } from "@/lib/canvas-size";
import { useEditorStore } from "@/stores/editor";
import type { FrameTemplate, TemplatePlacement } from "@/templates/schema";
import {
  clampTransform,
  composeTransform,
  pinchTransform,
  rotateTo,
  toFocal,
  toZoom,
  zoomAt,
  type PhotoTransform,
  type Size,
} from "./transform";
import { downscaleBitmap } from "./photo-loader";
import { useImageElement } from "./use-image";

/**
 * 미리보기 캔버스 해상도 — **조작 중에만 낮춘다** (사용자 확정 2026-07-29).
 * DPR 3 기기에서 화면 크기 캔버스 3장을 3배로 다시 칠하면 조작 중 프레임이 밀리고
 * (실측 p90 54ms → 상한 2에서 25ms), 반대로 항상 2로 고정하면 정지 화면이 흐려진다.
 * 그래서 드래그·핀치·휠 중에는 2, 손을 떼면 기기 해상도(최대 3)로 되돌린다.
 * 내보내기는 `toCanvas()`가 pixelRatio 1(템플릿 원본 해상도)을 쓰므로 영향받지 않는다.
 */
const MAX_IDLE_PIXEL_RATIO = 3;
const MAX_INTERACTING_PIXEL_RATIO = 2;
const devicePixelRatio = () =>
  typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
if (typeof window !== "undefined") {
  // 이후 새로 만들어지는 레이어 캔버스의 기본값 (비율 전환 등으로 재생성될 때)
  KonvaLib.pixelRatio = Math.min(devicePixelRatio(), MAX_IDLE_PIXEL_RATIO);
}

/** 원본 재디코딩 상한 — 확대 시 화질 회복용, 메모리 폭주 방지 (스펙 03 성능 노트) */
const MAX_SOURCE_WIDTH = 4096;
/**
 * 하향 목표 = 필요 폭 × 1 (상향과 같은 "정확 공급" 철학) — 내보내기가 리샘플링 없는 1:1
 * 블릿이 되어 에일리어싱이 원천 제거된다. 축소는 전부 createImageBitmap의 고품질
 * 리샘플러가 담당. 모바일 미리보기 백킹(≈1.0×)도 그대로 커버한다 (실측 2026-08-07:
 * 한 방 7~9배 축소 에너지 109 → ×2 공급 89 → ×1 공급이 이상적 축소본과 동급)
 */
const FIT_HEADROOM = 1;
/** 하향 트리거 = 목표의 1.5배 초과일 때만 — 상향(1.05)과 함께 재디코드 핑퐁 방지 밴드 형성 */
const FIT_HYSTERESIS = 1.5;

/** 내보내기 함수 시그니처 — 메인 레이어를 캔버스 좌표계 네이티브 해상도로 래스터화 (스펙 04) */
export type ExportFn = () => HTMLCanvasElement | null;

/** 슬롯 그룹 이름 — 내보내기 직전 원본 해상도 재캐시 대상을 찾는 데 쓴다 */
const SLOT_GROUP_NAME = "slot-group";

/**
 * 슬롯 마스크 캐시 해상도. 조작 중 매 프레임 다시 구워지므로 화면에 보이는 크기로 맞춘다 —
 * 기본값(devicePixelRatio)은 템플릿 원본(1080폭) 기준이라 큰 슬롯에서 프레임당 수백만
 * 픽셀을 새로 그리게 되어 드래그·핀치가 끊긴다. 내보내기 직전에만 원본 해상도로 다시 굽는다.
 */
function previewCachePixelRatio(
  stageScale: number,
  previewPixelRatio: number,
): number {
  return Math.min(
    Math.max(stageScale * previewPixelRatio, 0.5),
    MAX_IDLE_PIXEL_RATIO,
  );
}

interface EditorCanvasProps {
  template: FrameTemplate;
  /**
   * 파일 선택 트리거 — 빈 슬롯 + 배지·📷 교체 버튼(DOM 오버레이)에서만 호출된다.
   * iOS는 숨김 input의 파일 메뉴를 "활성화 요소"에 앵커링하므로, 캔버스 탭에서 열면
   * 캔버스 크기의 프리뷰 판(블롭)이 그려진다 — 반드시 작은 DOM 버튼이 트리거여야 한다.
   */
  onSlotTap: (slotId: string) => void;
  /** EditorShell이 다운로드 시 호출할 내보내기 함수를 여기 담아준다 */
  exportRef: React.MutableRefObject<ExportFn | null>;
}

/**
 * 메인 레이어를 프레임 영역으로 자르는 클립 — 스테이지가 편집 영역 전체를 덮으므로
 * 프레임 바깥으로 새는 그림과 라운드 코너(화면 8px)를 여기서 처리한다.
 * 고스트·선택 컨트롤 레이어에는 적용하지 않는다 (프레임 밖에도 보여야 하므로).
 */
function roundedFrameClip(canvas: Size, stageScale: number) {
  return (ctx: Konva.Context) => {
    const r = 8 / stageScale;
    const { width: w, height: h } = canvas;
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
  };
}

/**
 * 슬롯의 최신 합성 변환을 읽어 updater를 적용하고 초점·줌·회전(모두 비율 간 공유)으로 분해 저장한다.
 * 윈도우 리스너(클로저)에서도 안전하도록 항상 스토어에서 최신 상태를 읽는다.
 */
function applySlotUpdate(
  slot: string,
  rect: { x: number; y: number; width: number; height: number },
  updater: (current: PhotoTransform, size: Size) => PhotoTransform,
) {
  const state = useEditorStore.getState();
  const photo = state.photos[slot];
  if (!photo) return;
  const size = { width: photo.bitmap.width, height: photo.bitmap.height };
  const current = composeTransform(
    state.focals[slot] ?? null,
    state.zooms[slot] ?? 1,
    state.rotations[slot] ?? 0,
    size,
    rect,
  );
  const next = updater(current, size);
  state.setFocal(slot, toFocal(next));
  const zoom = toZoom(next, size, rect);
  if (zoom !== (state.zooms[slot] ?? 1)) state.setZoom(slot, zoom);
  if (next.rotation !== (state.rotations[slot] ?? 0)) {
    state.setRotation(slot, next.rotation);
  }
}

export default function EditorCanvas({
  template,
  onSlotTap,
  exportRef,
}: EditorCanvasProps) {
  const variant = useEditorStore((s) => s.variant);
  const photos = useEditorStore((s) => s.photos);
  const selectedSlot = useEditorStore((s) => s.selectedSlot);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setViewport({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const variantData = template.variants[variant];
  const base = useImageElement(variantData.assets.base);
  const overlay = useImageElement(variantData.assets.overlay);
  // 2배 내보내기용 프레임 에셋 — 미리 받아두고 내보내는 순간에만 교체해 그린다 (스펙 04).
  // 로드가 안 끝났으면 1080 에셋으로 내보낸다 (우아한 저하)
  const base2x = useImageElement(variantData.assets.base2x);
  const overlay2x = useImageElement(variantData.assets.overlay2x);
  const fitted =
    viewport.width > 0 && viewport.height > 0
      ? fitToViewport(variant, viewport)
      : null;

  /**
   * 스테이지는 프레임이 아니라 편집 영역 전체를 덮는다 (기획 피드백 2026-07-29):
   * 프레임 밖으로 넘치는 고스트가 잘리지 않고, 프레임 밖에서도 제스처를 받을 수 있다.
   * 프레임은 그 안에 중앙 배치되고, 레이어 원점을 프레임 좌상단으로 옮겨
   * 템플릿 좌표(placement.rect)는 기존과 동일하게 쓴다.
   */
  const stageSize = fitted ? viewport : null;
  const origin = fitted
    ? (() => {
        // 정수 px로 스냅 — 프레임이 픽셀 격자에 딱 맞아 서브픽셀 번짐이 없다
        const left = Math.round((viewport.width - fitted.width) / 2);
        const top = Math.round((viewport.height - fitted.height) / 2);
        // 캔버스 단위 (레이어 x/y에는 스테이지 스케일이 곱해진다)
        return { left, top, x: left / fitted.scale, y: top / fitted.scale };
      })()
    : null;

  /**
   * 반대 비율 에셋 미리 받기 (사용자 확정 2026-07-29) — post↔story는 서로 다른
   * base/overlay/마스크 파일을 쓴다. 전환 시점에 받기 시작하면 그동안 캔버스가 비어
   * 깜빡인다 (실측: 느린 4G·캐시 없음에서 약 390ms). 현재 비율이 다 그려진 뒤에
   * 백그라운드로 받아 두면 전환이 즉시 이뤄진다.
   */
  useEffect(() => {
    if (!base || !overlay) return; // 보이는 비율이 먼저 — 대역폭 경쟁 방지
    const other = template.variants[variant === "post" ? "story" : "post"];
    const sources = [
      other.assets.base,
      other.assets.overlay,
      ...other.placements.flatMap((p) => (p.mask ? [p.mask] : [])),
    ];
    // 브라우저 HTTP 캐시에만 올려두면 되므로 결과는 쓰지 않는다
    const preloaded = sources.map((src) => {
      const image = new window.Image();
      image.src = src;
      return image;
    });
    return () => {
      // 언마운트 시 남은 요청은 그대로 캐시에 들어가도 무해하다 — 참조만 끊는다
      preloaded.length = 0;
    };
  }, [base, overlay, template, variant]);

  // 조작 중에는 해상도를 낮춰 프레임을 지키고, 손을 떼면 기기 해상도로 되돌린다
  const [interacting, setInteracting] = useState(false);
  const previewPixelRatio = Math.min(
    devicePixelRatio(),
    interacting ? MAX_INTERACTING_PIXEL_RATIO : MAX_IDLE_PIXEL_RATIO,
  );
  const cachePixelRatio = fitted
    ? previewCachePixelRatio(fitted.scale, previewPixelRatio)
    : 1;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    for (const layer of stage.getLayers()) {
      layer.getCanvas().setPixelRatio(previewPixelRatio);
    }
    stage.batchDraw();
  }, [previewPixelRatio, stageSize?.width, stageSize?.height, variantData]);

  /**
   * 확대해서 원본보다 더 큰 해상도가 필요해지면 원본 파일을 그 배율로 다시 디코딩한다
   * (사용자 확정 2026-07-29). 첨부 시에는 2160px로 가볍게 들고 있다가, 조작이 끝난 뒤
   * 필요한 만큼만 올린다 — 내보내기는 동기 경로를 유지해야 해서(iOS 공유 시트의 사용자
   * 제스처 제약) 저장 시점이 아니라 편집이 끝난 시점에 미리 올려둔다.
   */
  // 사진 해상도 관리 (양방향, 스펙 03 화질 노트):
  // 부족하면 원본에서 키우고(상향, 목표 1.0×), 과대하면 고품질 리사이저로 줄인다(하향, 목표 2×).
  // 하향이 없으면 작은 슬롯(Weekly Dump 232px)에서 7~9배 단일 패스 축소가 일어나
  // 고주파 사진이 에일리어싱으로 깨진다 (2026-08-07 실기기 제보 → 실측 원인 규명)
  const manageSourceResolution = useCallback(async () => {
    for (const placement of variantData.placements) {
      const state = useEditorStore.getState();
      const photo = state.photos[placement.slot];
      if (!photo?.file || !photo.sourceSize) continue;
      const size = { width: photo.bitmap.width, height: photo.bitmap.height };
      const stored = composeTransform(
        state.focals[placement.slot] ?? null,
        state.zooms[placement.slot] ?? 1,
        state.rotations[placement.slot] ?? 0,
        size,
        placement.rect,
      );
      // 내보내기에서 이 사진이 차지할 픽셀 폭 — 좌표계(1080) × 내보내기 래스터 배율
      const needed = size.width * stored.scale * EXPORT_PIXEL_RATIO;
      const upTarget = Math.min(
        Math.ceil(needed),
        photo.sourceSize.width,
        MAX_SOURCE_WIDTH,
      );
      const fitTarget = Math.min(
        Math.ceil(needed * FIT_HEADROOM),
        photo.sourceSize.width,
        MAX_SOURCE_WIDTH,
      );
      const wantUp = upTarget > size.width * 1.05; // 부족 (5% 여유)
      const wantFit = size.width > fitTarget * FIT_HYSTERESIS; // 과대 (히스테리시스)
      if (!wantUp && !wantFit) continue; // 안정 구간
      // 축소는 반드시 점진 반감(downscaleBitmap) — 단일 패스 리사이즈는 대배율에서
      // 에일리어싱을 낸다 (createImageBitmap resizeQuality: "high"도 마찬가지, 실측 151 vs 33)
      try {
        if (wantFit) {
          // 하향: 이미 들고 있는 비트맵에서 줄인다 (파일 재디코드 불필요)
          const target = fitTarget;
          const bitmap = await downscaleBitmap(
            photo.bitmap,
            target,
            Math.round((target * size.height) / size.width),
          );
          useEditorStore.getState().fitPhoto(placement.slot, bitmap);
        } else {
          // 상향: 원본을 통째로 디코드한 뒤 목표까지 점진 축소
          const target = upTarget;
          const full = await createImageBitmap(photo.file, {
            imageOrientation: "from-image",
          });
          const bitmap =
            target >= full.width
              ? full
              : await downscaleBitmap(
                  full,
                  target,
                  Math.round((target * full.height) / full.width),
                );
          if (bitmap !== full) full.close();
          useEditorStore.getState().upgradePhoto(placement.slot, bitmap);
        }
      } catch {
        // 재디코딩 실패는 화질만 낮출 뿐 편집을 막지 않는다 — 조용히 넘어간다
      }
    }
  }, [variantData]);

  // 사진별 비트맵 폭 지문 — 첨부·교체·재디코드 시 관리 로직 재평가 트리거
  // (재디코드 자체도 지문을 바꾸지만, 결과가 안정 구간에 들어가므로 1회로 수렴한다)
  const photoWidths = useEditorStore((s) =>
    Object.entries(s.photos)
      .map(([slot, p]) => `${slot}:${p.bitmap.width}`)
      .join(","),
  );
  useEffect(() => {
    if (interacting) return;
    void manageSourceResolution();
  }, [interacting, manageSourceResolution, photoWidths]);

  // 내보내기: 스테이지를 잠시 1:1 프레임 크기로 되돌려 메인 레이어만 래스터화
  // (UI·선택 레이어 제외). 레이어 오프셋·라운드 클립을 걷어내고,
  // 슬롯 마스크 캐시는 미리보기 해상도 → 원본 해상도로 다시 구운 뒤 되돌린다
  useEffect(() => {
    exportRef.current = () => {
      const stage = stageRef.current;
      if (!stage) return null;
      const layer = stage.getLayers()[0];
      const prev = {
        scale: stage.scaleX(),
        width: stage.width(),
        height: stage.height(),
        position: layer.position(),
        clipFunc: layer.clipFunc(),
      };
      const slots = layer
        .find(`.${SLOT_GROUP_NAME}`)
        .filter((node) => node.isCached());
      const recache = (pixelRatio: number) => {
        for (const node of slots) {
          node.cache({
            x: 0,
            y: 0,
            width: node.getAttr("slotWidth"),
            height: node.getAttr("slotHeight"),
            pixelRatio,
          });
        }
      };
      recache(EXPORT_PIXEL_RATIO); // 내보내기 래스터 해상도 — 화질 보장
      layer.clipFunc(undefined); // 미리보기용 라운드 코너는 내보내기에 넣지 않는다
      layer.position({ x: 0, y: 0 });
      stage.scale({ x: 1, y: 1 });
      stage.size(variantData.canvas);
      // 프레임 에셋을 @2x로 잠시 교체 — 1080 에셋 업스케일로 인한 아트 소프트닝 방지.
      // 노드 width/height가 캔버스 좌표로 고정돼 있어 교체해도 레이아웃은 그대로다
      const swaps: Array<[Konva.Image, HTMLImageElement]> = [];
      const trySwap = (name: string, hi: HTMLImageElement | null) => {
        const node = layer.findOne<Konva.Image>(`.${name}`);
        if (node && hi) {
          swaps.push([node, node.image() as HTMLImageElement]);
          node.image(hi);
        }
      };
      trySwap("base-image", base2x);
      trySwap("overlay-image", overlay2x);
      const canvas = layer.toCanvas({ pixelRatio: EXPORT_PIXEL_RATIO });
      for (const [node, original] of swaps) node.image(original);
      layer.clipFunc(prev.clipFunc);
      layer.position(prev.position);
      stage.scale({ x: prev.scale, y: prev.scale });
      stage.size({ width: prev.width, height: prev.height });
      recache(cachePixelRatio); // 미리보기 해상도로 복귀
      stage.batchDraw();
      return canvas;
    };
    return () => {
      exportRef.current = null;
    };
  }, [exportRef, variantData, cachePixelRatio, base2x, overlay2x]);

  return (
    <div
      data-testid="editor-canvas"
      // 프레임 위치·배율 — E2E가 템플릿 좌표를 화면 좌표로 환산할 때 쓴다
      data-frame-left={origin?.left ?? 0}
      data-frame-top={origin?.top ?? 0}
      data-frame-width={fitted?.width ?? 0}
      data-frame-height={fitted?.height ?? 0}
      data-frame-scale={fitted?.scale ?? 0}
      className="flex min-h-0 w-full flex-1 p-4"
    >
      {/* 안쪽 div가 측정 기준 — 바깥 p-4가 프레임 카드 그림자의 숨쉴 공간 */}
      <div
        ref={containerRef}
        // touch-none: 캔버스 제스처(드래그/핀치)가 페이지 스크롤로 새지 않게
        className="relative h-full w-full touch-none"
      >
        {fitted && base && stageSize && origin && (
          <>
            {/* 프레임 카드 배경 — 그림자·라운드는 스테이지 뒤 DOM이 담당 (스테이지는 전체를 덮는다) */}
            <div
              className="absolute rounded-lg bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_8px_32px_rgba(0,0,0,0.18)]"
              style={{
                left: origin.left,
                top: origin.top,
                width: fitted.width,
                height: fitted.height,
              }}
            />
            <Stage
              ref={stageRef}
              width={stageSize.width}
              height={stageSize.height}
              scaleX={fitted.scale}
              scaleY={fitted.scale}
              className="absolute inset-0"
            >
              <Layer
                x={origin.x}
                y={origin.y}
                clipFunc={roundedFrameClip(variantData.canvas, fitted.scale)}
              >
                {/* 프레임 배경 — 탭해도 선택은 유지된다 (해제는 사진 재탭 또는
                    캔버스 바깥 페이지 여백 탭, 기획 확정 2026-07-29) */}
                <KonvaImage
                  image={base}
                  name="base-image"
                  width={variantData.canvas.width}
                  height={variantData.canvas.height}
                />
                {variantData.placements.map((placement) => (
                  <PlacementNode
                    key={placement.slot}
                    placement={placement}
                    stageScale={fitted.scale}
                    cachePixelRatio={cachePixelRatio}
                  />
                ))}
                {overlay && (
                  <KonvaImage
                    image={overlay}
                    name="overlay-image"
                    width={variantData.canvas.width}
                    height={variantData.canvas.height}
                    listening={false}
                  />
                )}
              </Layer>
              {/* UI 레이어 — 내보내기·시각 회귀 비교 대상이 아니다.
                  클립이 없어 프레임 밖으로 넘치는 고스트도 그대로 보인다 */}
              <Layer x={origin.x} y={origin.y} listening={false}>
                {variantData.placements.map((placement) => (
                  <GhostPhoto key={placement.slot} placement={placement} />
                ))}
              </Layer>
              {/* 선택 컨트롤 레이어 — 역시 내보내기 제외, 버튼은 탭 가능 */}
              <Layer x={origin.x} y={origin.y}>
                <SelectionControls
                  variantData={variantData}
                  stageScale={fitted.scale}
                  onInteracting={setInteracting}
                  stageArea={{
                    x: -origin.x,
                    y: -origin.y,
                    width: stageSize.width / fitted.scale,
                    height: stageSize.height / fitted.scale,
                  }}
                />
              </Layer>
            </Stage>
            {/* 파일 선택 트리거는 반드시 DOM 버튼 — iOS 파일 메뉴가 이 버튼에 작게 앵커된다.
                캔버스(Konva)에서 열면 캔버스 크기의 프리뷰 판이 그려진다 (스펙 06 변경 이력).
                보이는 원은 캔버스 배율을 따라 작게(원 디자인 68px), 탭 영역은 44px 보장 */}
            {variantData.placements
              .filter((p) => !photos[p.slot])
              .map((p) => {
                const badge = Math.round(68 * fitted.scale);
                return (
                  <button
                    key={p.slot}
                    type="button"
                    aria-label="사진 추가"
                    data-testid={`attach-${p.slot}`}
                    className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center"
                    style={{
                      left:
                        origin.left +
                        (p.rect.x + p.rect.width / 2) * fitted.scale,
                      top:
                        origin.top +
                        (p.rect.y + p.rect.height / 2) * fitted.scale,
                    }}
                    onClick={() => onSlotTap(p.slot)}
                  >
                    <span
                      aria-hidden
                      className="flex items-center justify-center rounded-full bg-white/92 font-light text-[#333] shadow-[0_1px_4px_rgba(0,0,0,0.18)]"
                      style={{
                        width: badge,
                        height: badge,
                        fontSize: Math.round(badge * 0.58),
                      }}
                    >
                      +
                    </span>
                  </button>
                );
              })}
            <ReplaceButton
              variantData={variantData}
              stageScale={fitted.scale}
              origin={origin}
              stageSize={stageSize}
              selectedSlot={selectedSlot}
              hasPhoto={Boolean(selectedSlot && photos[selectedSlot])}
              onReplace={onSlotTap}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 선택된 슬롯의 사진 전체를 35% 투명도로 보여준다 — 슬롯 밖으로 잘리는 영역 미리보기 (스펙 06).
 * 슬롯 안쪽은 아래(메인 레이어)의 불투명 사진과 같은 픽셀이라 겹쳐도 표가 나지 않는다.
 */
function GhostPhoto({ placement }: { placement: TemplatePlacement }) {
  const selected = useEditorStore((s) => s.selectedSlot === placement.slot);
  const photo = useEditorStore((s) => s.photos[placement.slot]);
  const focal = useEditorStore((s) => s.focals[placement.slot]);
  const rotation = useEditorStore((s) => s.rotations[placement.slot] ?? 0);
  const zoom = useEditorStore((s) => s.zooms[placement.slot] ?? 1);
  if (!selected || !photo) return null;
  const size = { width: photo.bitmap.width, height: photo.bitmap.height };
  const stored = composeTransform(
    focal ?? null,
    zoom,
    rotation,
    size,
    placement.rect,
  );
  const drawnW = size.width * stored.scale;
  const drawnH = size.height * stored.scale;
  return (
    <KonvaImage
      image={photo.bitmap}
      x={placement.rect.x + placement.rect.width / 2 + stored.x}
      y={placement.rect.y + placement.rect.height / 2 + stored.y}
      offsetX={drawnW / 2}
      offsetY={drawnH / 2}
      width={drawnW}
      height={drawnH}
      rotation={(stored.rotation * 180) / Math.PI}
      opacity={0.35}
      listening={false}
    />
  );
}

/** 📷 교체 버튼 — DOM 오버레이 (iOS 파일 메뉴가 이 버튼에 앵커되도록 Konva가 아닌 DOM) */
function ReplaceButton({
  variantData,
  stageScale,
  origin,
  stageSize,
  selectedSlot,
  hasPhoto,
  onReplace,
}: {
  variantData: FrameTemplate["variants"]["post"];
  stageScale: number;
  origin: { left: number; top: number };
  stageSize: Size;
  selectedSlot: string | null;
  hasPhoto: boolean;
  onReplace: (slotId: string) => void;
}) {
  const placement = variantData.placements.find((p) => p.slot === selectedSlot);
  if (!placement || !selectedSlot || !hasPhoto) return null;
  const { rect } = placement;
  // SelectionControls의 배치 규칙과 동일: 슬롯 아래 바깥, 스테이지 안 22px 여백으로 클램프
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 22), max - 22);
  const left = clamp(
    origin.left + (rect.x + rect.width / 2) * stageScale,
    stageSize.width,
  );
  const top = clamp(
    origin.top + (rect.y + rect.height) * stageScale + 32,
    stageSize.height,
  );
  return (
    <button
      type="button"
      aria-label="사진 교체"
      data-testid="replace-photo"
      className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center"
      style={{ left, top }}
      onClick={() => onReplace(selectedSlot)}
    >
      {/* 보이는 원은 기존 Konva 버튼과 같은 36px — 탭 영역은 바깥 44px */}
      <span
        aria-hidden
        className="flex size-9 items-center justify-center rounded-full bg-white text-[#1c1c1e] shadow-[0_1px_5px_rgba(0,0,0,0.25)]"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {CAMERA_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </span>
    </button>
  );
}

interface PlacementNodeProps {
  placement: TemplatePlacement;
  stageScale: number;
  /** 슬롯 마스크 캐시 해상도 — 미리보기는 화면 크기, 내보내기 직전에만 원본(1) */
  cachePixelRatio: number;
}

interface GestureSession {
  pointers: Map<number, { x: number; y: number }>;
  /** 누적 이동량 (캔버스 좌표 단위) — 탭/드래그 판별 */
  moved: number;
  /** 직전 프레임의 두 손가락 거리·각도 — 배율·회전 증분 계산용 */
  lastDist: number | null;
  lastAngle: number | null;
  /** 두 손가락이 한 번이라도 닿았는가 — 탭(해제) 오인 방지 */
  multiTouch?: boolean;
  /** 제스처 동안 누적한 원본(스냅 전) 회전각 */
  rawRotation?: number;
  cleanup: () => void;
}

/** 각도 차이를 -π..π로 정규화 — atan2 경계(±π)를 넘을 때 튀는 것 방지 */
function normalizeAngle(delta: number): number {
  const twoPi = Math.PI * 2;
  return ((((delta + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

/**
 * 사진 배치와 탭(선택)/드래그/핀치 제스처를 담당하는 슬롯 노드.
 *
 * 마스크가 있는 자유 형상 슬롯만 destination-in 합성 + 그룹 캐시를 쓰고(현 라인업엔 없음 —
 * 미래 자유 형상 슬롯용 유지), **사각·둥근 사각 슬롯은 rect(+radius) 클립만으로 그린다** —
 * 캐시 재베이크가 없어 조작 비용이 훨씬 낮고, 내보내기도 벡터 원본 해상도로 바로 그려진다
 * (스펙 01·03).
 */
function PlacementNode({
  placement,
  stageScale,
  cachePixelRatio,
}: PlacementNodeProps) {
  const { rect } = placement;
  const needsMask = Boolean(placement.mask);
  const photo = useEditorStore((s) => s.photos[placement.slot]);
  const focal = useEditorStore((s) => s.focals[placement.slot]);
  const rotation = useEditorStore((s) => s.rotations[placement.slot] ?? 0);
  const zoom = useEditorStore((s) => s.zooms[placement.slot] ?? 1);
  const selected = useEditorStore((s) => s.selectedSlot === placement.slot);
  const setSelectedSlot = useEditorStore((s) => s.setSelectedSlot);

  const mask = useImageElement(placement.mask);
  const groupRef = useRef<Konva.Group>(null);

  const photoSize = photo
    ? { width: photo.bitmap.width, height: photo.bitmap.height }
    : null;
  // 공유 초점·줌·회전 합성 — 초점이 없어도(첫 첨부) 항상 유효한 변환이 나온다
  const stored = photoSize
    ? composeTransform(focal ?? null, zoom, rotation, photoSize, rect)
    : null;

  // 마스크 합성(destination-in)은 그룹 캐시 안에서만 적용되어야 레이어 전체를 지우지 않는다.
  // 마스크 없는 사각 슬롯은 캐시 없이 rect 클립으로 그린다
  const ready = Boolean(photo && stored && (!needsMask || mask));
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    if (ready && needsMask) {
      group.cache({
        x: 0,
        y: 0,
        width: rect.width,
        height: rect.height,
        pixelRatio: cachePixelRatio,
      });
    } else {
      group.clearCache();
    }
    group.getLayer()?.batchDraw();
    return () => {
      group.clearCache();
    };
  }, [
    ready,
    needsMask,
    stored?.x,
    stored?.y,
    stored?.scale,
    stored?.rotation,
    rect.width,
    rect.height,
    cachePixelRatio,
  ]);

  const sessionRef = useRef<GestureSession | null>(null);
  useEffect(() => () => sessionRef.current?.cleanup(), []);

  /** 클라이언트 좌표 → 슬롯 로컬 좌표 (레이어 오프셋·스테이지 배율 역산) */
  const toLocal = (clientX: number, clientY: number) => {
    const node = groupRef.current;
    const box = node?.getStage()?.container().getBoundingClientRect();
    if (!node || !box) return { x: 0, y: 0 };
    return node
      .getAbsoluteTransform()
      .copy()
      .invert()
      .point({ x: clientX - box.left, y: clientY - box.top });
  };

  /** 데스크톱 커서 힌트 — 미선택 pointer(탭 유도), 선택됨 grab, 드래그 중 grabbing */
  const setCursor = (cursor: string) => {
    const container = groupRef.current?.getStage()?.container();
    if (container) container.style.cursor = cursor;
  };
  const hoverCursor = () => setCursor(photo && selected ? "grab" : "pointer");
  const hoveredRef = useRef(false);
  const hoverKey = `${Boolean(photo)}:${selected}`;
  useEffect(() => {
    if (hoveredRef.current && !sessionRef.current) hoverCursor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverKey]);

  const isSelected = () =>
    useEditorStore.getState().selectedSlot === placement.slot;

  const applyDrag = (dx: number, dy: number) => {
    if (!isSelected()) return; // 조작은 선택 상태에서만 (스펙 06)
    applySlotUpdate(placement.slot, rect, (current, size) =>
      clampTransform(
        { ...current, x: current.x + dx, y: current.y + dy },
        size,
        rect,
      ),
    );
  };

  const applyZoom = (factor: number, focus: { x: number; y: number }) => {
    if (!isSelected()) return;
    applySlotUpdate(placement.slot, rect, (current, size) =>
      zoomAt(current, factor, focus, size, rect),
    );
  };

  const applyRotateDelta = (deltaRadians: number) => {
    if (!isSelected()) return;
    applySlotUpdate(placement.slot, rect, (current, size) =>
      rotateTo(current, current.rotation + deltaRadians, size, rect),
    );
  };

  /**
   * 제스처 세션 — 시작한 슬롯이 끝까지 소유한다 (윈도우 리스너로 포인터 캡처 의미론).
   * 탭 = 선택 토글(사진) 또는 파일 선택(빈 슬롯). 드래그/핀치는 선택된 슬롯만 반응한다.
   */
  const startSession = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const point = { x: e.evt.clientX, y: e.evt.clientY };
    const existing = sessionRef.current;
    if (existing) {
      // 두 번째 손가락 → 핀치 모드 진입 (드래그·탭 오인 금지)
      existing.pointers.set(e.evt.pointerId, point);
      existing.lastDist = null;
      existing.moved = 99;
      return;
    }
    const pointers = new Map([[e.evt.pointerId, point]]);
    if (photo && selected) setCursor("grabbing");
    const onMove = (ev: PointerEvent) => {
      const s = sessionRef.current;
      if (!s || !s.pointers.has(ev.pointerId)) return;
      const prev = s.pointers.get(ev.pointerId)!;
      s.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (s.pointers.size === 1) {
        const dx = (ev.clientX - prev.x) / stageScale;
        const dy = (ev.clientY - prev.y) / stageScale;
        s.moved += Math.abs(dx) + Math.abs(dy);
        if (s.moved > 3) applyDrag(dx, dy);
      } else if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (s.lastDist !== null && s.lastDist > 0) {
          applyZoom(
            dist / s.lastDist,
            toLocal((a.x + b.x) / 2, (a.y + b.y) / 2),
          );
        }
        s.lastDist = dist;
      }
    };
    const onUp = (ev: PointerEvent) => {
      const s = sessionRef.current;
      if (!s || !s.pointers.has(ev.pointerId)) return;
      s.pointers.delete(ev.pointerId);
      s.lastDist = null;
      if (s.pointers.size > 0) return;
      s.cleanup();
      sessionRef.current = null;
      hoverCursor();
      // 이동이 거의 없으면 탭 — 사진은 선택 토글, 빈 슬롯은 해제만
      // (빈 슬롯의 파일 선택은 + 배지 DOM 버튼 담당 — 캔버스 탭에서 열면 iOS 블롭)
      if (s.moved < 6) {
        if (photo) {
          setSelectedSlot(selected ? null : placement.slot);
        } else {
          setSelectedSlot(null);
        }
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    sessionRef.current = {
      pointers,
      moved: 0,
      lastDist: null,
      lastAngle: null,
      cleanup,
    };
  };

  // 사각·둥근 사각 슬롯(마스크 없음)은 클립으로 사진을 가둔다 — 캐시·합성 불필요.
  // radius가 있으면 둥근 사각 경로로 클립한다 (스펙 01)
  const radius = placement.radius ?? 0;
  const clipProps = needsMask
    ? {}
    : radius > 0
      ? {
          clipFunc: (ctx: Konva.Context) => {
            const r = Math.min(radius, rect.width / 2, rect.height / 2);
            ctx.moveTo(r, 0);
            ctx.arcTo(rect.width, 0, rect.width, rect.height, r);
            ctx.arcTo(rect.width, rect.height, 0, rect.height, r);
            ctx.arcTo(0, rect.height, 0, 0, r);
            ctx.arcTo(0, 0, rect.width, 0, r);
            ctx.closePath();
          },
        }
      : { clipX: 0, clipY: 0, clipWidth: rect.width, clipHeight: rect.height };

  return (
    <Group
      ref={groupRef}
      x={rect.x}
      y={rect.y}
      // 내보내기 직전 원본 해상도 재캐시용 — 이름·슬롯 크기를 노드에 실어둔다
      name={SLOT_GROUP_NAME}
      slotWidth={rect.width}
      slotHeight={rect.height}
      {...clipProps}
    >
      {/* 빈 슬롯 자리표시 — base에 굽지 않고 코드가 그린다. 사진이 오면 사라져서
          투명 배경 사진도 프레임 배경이 그대로 비친다 (스펙 01, 사용자 확정 2026-08-07).
          ⚠ 마스크 슬롯은 제외 — 자유 형상 슬롯이 다시 생기면 마스크 형상 자리표시를
          구현해야 빈 상태가 비어 보이지 않는다 (스펙 01 렌더링 모델 경고 참조) */}
      {!photo && !needsMask && (
        <Rect
          width={rect.width}
          height={rect.height}
          cornerRadius={radius}
          fill="#D9D9D9"
          listening={false}
        />
      )}
      {/* 히트 영역 — 슬롯 형상과 무관하게 rect 전체가 탭 대상 (스펙 03) */}
      <Rect
        width={rect.width}
        height={rect.height}
        opacity={0}
        fill="#000"
        onMouseOver={() => {
          hoveredRef.current = true;
          hoverCursor();
        }}
        onMouseOut={() => {
          hoveredRef.current = false;
          if (!sessionRef.current) setCursor("");
        }}
        onPointerDown={startSession}
        onWheel={(e) => {
          e.evt.preventDefault();
          if (!isSelected()) return; // 조작은 선택 상태에서만
          // Shift를 누르면 휠 델타가 deltaX로 오는 환경(macOS 등)이 있다
          const delta =
            Math.abs(e.evt.deltaY) >= Math.abs(e.evt.deltaX)
              ? e.evt.deltaY
              : e.evt.deltaX;
          if (e.evt.shiftKey) {
            applyRotateDelta(delta * 0.002); // Shift+휠 = 자유 회전 (데스크톱 보조)
          } else {
            applyZoom(
              Math.exp(-delta * 0.002),
              toLocal(e.evt.clientX, e.evt.clientY),
            );
          }
        }}
      />
      {ready && photoSize && stored && (
        <>
          <KonvaImage
            image={photo!.bitmap}
            x={rect.width / 2 + stored.x}
            y={rect.height / 2 + stored.y}
            offsetX={(photoSize.width * stored.scale) / 2}
            offsetY={(photoSize.height * stored.scale) / 2}
            width={photoSize.width * stored.scale}
            height={photoSize.height * stored.scale}
            rotation={(stored.rotation * 180) / Math.PI}
            listening={false}
          />
          {needsMask && (
            <KonvaImage
              image={mask!}
              listening={false}
              globalCompositeOperation="destination-in"
            />
          )}
        </>
      )}
    </Group>
  );
}

/** lucide 아이콘 패스 (24×24 기준) */
const CAMERA_PATHS = [
  "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",
  "M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
];

interface SelectionControlsProps {
  variantData: FrameTemplate["variants"]["post"];
  stageScale: number;
  /** 스테이지 전체 영역 (프레임 좌표계 기준) — 제스처 표면·버튼 클램프 범위 */
  stageArea: { x: number; y: number; width: number; height: number };
  /** 조작 중 여부 — 미리보기 해상도를 낮췄다가 되돌리는 신호 */
  onInteracting: (active: boolean) => void;
}

/** 선택 테두리 + ✕(사진 삭제) 오버레이 — 📷는 DOM(ReplaceButton), 회전은 두 손가락 (스펙 06) */
function SelectionControls({
  variantData,
  stageScale,
  stageArea,
  onInteracting,
}: SelectionControlsProps) {
  const selected = useEditorStore((s) => s.selectedSlot);
  const photo = useEditorStore((s) =>
    selected ? s.photos[selected] : undefined,
  );
  const removePhoto = useEditorStore((s) => s.removePhoto);
  const setSelectedSlot = useEditorStore((s) => s.setSelectedSlot);
  const groupRef = useRef<Konva.Group>(null);
  const gestureSession = useRef<GestureSession | null>(null);
  const wheelIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      gestureSession.current?.cleanup();
      if (wheelIdleTimer.current) clearTimeout(wheelIdleTimer.current);
    },
    [],
  );

  /** 휠은 시작·끝 이벤트가 없어 마지막 휠 이후 잠깐 기다렸다 조작 종료로 본다 */
  const markWheeling = () => {
    onInteracting(true);
    if (wheelIdleTimer.current) clearTimeout(wheelIdleTimer.current);
    wheelIdleTimer.current = setTimeout(() => onInteracting(false), 250);
  };

  // 한 번의 물리 탭이 브라우저에 따라 click/tap/pointerclick 여러 konva 이벤트로 합성되므로
  // (iOS는 pointer+touch+호환 mouse를 모두 발사) 짧은 창 안의 중복 실행을 막는다
  const lastFire = useRef<Record<string, number>>({});
  const fireOnce = (key: string) => {
    const now = Date.now();
    if (now - (lastFire.current[key] ?? 0) < 400) return false;
    lastFire.current[key] = now;
    return true;
  };

  const placement = variantData.placements.find((p) => p.slot === selected);
  if (!placement || !photo || !selected) return null;
  const { rect } = placement;
  /** 화면 픽셀 크기 고정용 — 스테이지 스케일 역산 */
  const px = (n: number) => n / stageScale;
  // 버튼은 프레임이 아니라 스테이지(편집 영역 전체) 안으로 클램프 — 프레임 밖 여백도 쓴다
  const clampX = (v: number) =>
    Math.min(
      Math.max(v, stageArea.x + px(22)),
      stageArea.x + stageArea.width - px(22),
    );
  const clampY = (v: number) =>
    Math.min(
      Math.max(v, stageArea.y + px(22)),
      stageArea.y + stageArea.height - px(22),
    );

  const closeX = clampX(rect.x + rect.width);
  const closeY = clampY(rect.y);

  /** 클라이언트 좌표 → 프레임(템플릿) 좌표 — 레이어 오프셋·스테이지 배율을 함께 역산 */
  const toCanvas = (clientX: number, clientY: number) => {
    const node = groupRef.current;
    const box = node?.getStage()?.container().getBoundingClientRect();
    if (!node || !box) return { x: 0, y: 0 };
    return node
      .getAbsoluteTransform()
      .copy()
      .invert()
      .point({ x: clientX - box.left, y: clientY - box.top });
  };

  const setCursor = (cursor: string) => {
    const c = groupRef.current?.getStage()?.container();
    if (c) c.style.cursor = cursor;
  };

  /**
   * 제스처 표면 탭 — 표면이 프레임 안팎을 모두 덮으므로, 탭한 지점으로 의미를 정한다
   * (기획 확정 2026-07-29):
   * - **프레임 바깥**(좌우·상하 여백) → 해제. 스테이지가 편집 영역 전체를 덮으므로
   *   눈에는 빈 여백이어도 캔버스 안이다 — 여기서 직접 처리해야 한다.
   * - 프레임 안 배경 → 아무 것도 하지 않음 (확대·회전 중 실수로 풀리지 않게)
   * - 선택된 사진 재탭 → 해제 / 다른 사진 → 선택 전환
   * 빈 슬롯의 파일 선택은 + 배지 DOM 버튼이 표면 위에 떠 있어 여기로 오지 않는다.
   */
  const handleSurfaceTap = (clientX: number, clientY: number) => {
    const p = toCanvas(clientX, clientY);
    const { width: canvasW, height: canvasH } = variantData.canvas;
    if (p.x < 0 || p.y < 0 || p.x > canvasW || p.y > canvasH) {
      setSelectedSlot(null); // 프레임 바깥 여백 → 해제
      return;
    }
    const hit = variantData.placements.find(
      (pl) =>
        p.x >= pl.rect.x &&
        p.x <= pl.rect.x + pl.rect.width &&
        p.y >= pl.rect.y &&
        p.y <= pl.rect.y + pl.rect.height,
    );
    if (!hit) return; // 프레임 안 배경 — 선택 유지
    if (hit.slot === selected) {
      setSelectedSlot(null); // 선택된 사진 재탭 → 해제
    } else if (useEditorStore.getState().photos[hit.slot]) {
      setSelectedSlot(hit.slot); // 다른 사진 → 선택 전환
    }
  };

  /**
   * 제스처 표면 세션 — 표면이 편집 영역 전체를 덮는다 (기획 요청 2026-07-29).
   * **선택된 사진이 편집 영역 전체를 소유한다**: 한 손가락 드래그(이동)도, 두 손가락
   * 제스처(확대/축소 + 회전 동시)도 사진 밖 어디서 시작해도 동작한다.
   * 두 손가락이 한 번이라도 닿았거나(multiTouch) 취소된 제스처는 탭으로 보지 않는다 —
   * 확대하다가 선택이 풀리던 문제의 원인.
   */
  const startGesture = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const point = { x: e.evt.clientX, y: e.evt.clientY };
    const existing = gestureSession.current;
    if (existing) {
      // 두 번째 손가락 → 확대·회전 모드 진입 (드래그·탭 오인 금지).
      // 회전은 제스처 시작 각도부터 누적해야 스냅(±3°)에 갇히지 않는다
      existing.pointers.set(e.evt.pointerId, point);
      existing.lastDist = null;
      existing.lastAngle = null;
      existing.multiTouch = true;
      existing.rawRotation = useEditorStore.getState().rotations[selected] ?? 0;
      return;
    }
    const pointers = new Map([[e.evt.pointerId, point]]);
    setCursor("grabbing");
    onInteracting(true); // 조작 중 — 미리보기 해상도를 낮춘다
    const onMove = (ev: PointerEvent) => {
      const s = gestureSession.current;
      if (!s || !s.pointers.has(ev.pointerId)) return;
      const prev = s.pointers.get(ev.pointerId)!;
      s.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (s.pointers.size === 1) {
        const dx = (ev.clientX - prev.x) / stageScale;
        const dy = (ev.clientY - prev.y) / stageScale;
        s.moved += Math.abs(dx) + Math.abs(dy);
        if (s.moved > 3) {
          applySlotUpdate(selected, rect, (current, size) =>
            clampTransform(
              { ...current, x: current.x + dx, y: current.y + dy },
              size,
              rect,
            ),
          );
        }
      } else if (s.pointers.size === 2) {
        // 두 손가락: 벌린 거리 = 배율, 두 점을 잇는 선의 각도 변화 = 회전 (동시 적용)
        const [a, b] = [...s.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        if (s.lastDist !== null && s.lastDist > 0 && s.lastAngle !== null) {
          const mid = toCanvas((a.x + b.x) / 2, (a.y + b.y) / 2);
          const factor = dist / s.lastDist;
          // 누적 각도로 관리 — 증분마다 스냅하면 매번 0으로 되돌아간다
          s.rawRotation =
            (s.rawRotation ?? 0) + normalizeAngle(angle - s.lastAngle);
          const target = s.rawRotation;
          applySlotUpdate(selected, rect, (current, size) =>
            pinchTransform(
              current,
              factor,
              target,
              { x: mid.x - rect.x, y: mid.y - rect.y },
              size,
              rect,
            ),
          );
        }
        s.lastDist = dist;
        s.lastAngle = angle;
      }
    };
    const onUp = (ev: PointerEvent) => {
      const s = gestureSession.current;
      if (!s || !s.pointers.has(ev.pointerId)) return;
      s.pointers.delete(ev.pointerId);
      s.lastDist = null;
      s.lastAngle = null;
      if (s.pointers.size > 0) return;
      s.cleanup();
      gestureSession.current = null;
      setCursor("");
      onInteracting(false); // 조작 끝 — 해상도 복귀 + 필요하면 원본 재디코딩
      // 한 손가락으로 거의 움직이지 않은 경우만 탭 — 확대·회전 후에는 선택을 유지한다
      if (s.moved < 6 && !s.multiTouch)
        handleSurfaceTap(ev.clientX, ev.clientY);
    };
    const onCancel = () => {
      const s = gestureSession.current;
      if (!s) return;
      s.cleanup(); // 취소된 제스처는 탭으로 해석하지 않는다
      gestureSession.current = null;
      setCursor("");
      onInteracting(false);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    gestureSession.current = {
      pointers,
      moved: 0,
      lastDist: null,
      lastAngle: null,
      cleanup,
    };
  };

  /** ✕ — 선택된 사진 삭제 (탭 완료 시점, 합성 이벤트 중복 방어) */
  const handleRemoveTap = () => {
    if (!fireOnce("remove")) return;
    removePhoto(selected);
  };

  return (
    <Group ref={groupRef}>
      {/* 제스처 표면 — 편집 영역 전체. 핀치/휠 줌은 사진 밖에서도 동작하고,
          한 손가락 드래그는 사진(고스트 포함) 위에서 시작한 경우만 이동한다 */}
      <Rect
        name="gesture-surface"
        x={stageArea.x}
        y={stageArea.y}
        width={stageArea.width}
        height={stageArea.height}
        opacity={0}
        fill="#000"
        onPointerDown={startGesture}
        onWheel={(e) => {
          e.evt.preventDefault();
          markWheeling(); // 휠도 조작 — 멈추면 해상도 복귀
          const delta =
            Math.abs(e.evt.deltaY) >= Math.abs(e.evt.deltaX)
              ? e.evt.deltaY
              : e.evt.deltaX;
          if (e.evt.shiftKey) {
            applySlotUpdate(selected, rect, (current, size) =>
              rotateTo(current, current.rotation + delta * 0.002, size, rect),
            );
          } else {
            const f = toCanvas(e.evt.clientX, e.evt.clientY);
            applySlotUpdate(selected, rect, (current, size) =>
              zoomAt(
                current,
                Math.exp(-delta * 0.002),
                { x: f.x - rect.x, y: f.y - rect.y },
                size,
                rect,
              ),
            );
          }
        }}
        onMouseOver={() => {
          // 선택 중에는 편집 영역 어디서나 드래그로 이동한다 — 커서로 그 사실을 알린다
          if (!gestureSession.current) setCursor("grab");
        }}
        onMouseOut={() => {
          if (!gestureSession.current) setCursor("");
        }}
      />
      {/* 선택 테두리 — 슬롯 rect에 여백 없이 딱 붙는다 */}
      <Rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        stroke="#ffffff"
        strokeWidth={px(3)}
        shadowColor="rgba(0,0,0,0.4)"
        shadowBlur={px(4)}
        listening={false}
      />
      {/* ✕ 사진 삭제 (우상단) — 슬롯을 빈 상태로 되돌린다 (선택 해제는 배경 탭·재탭).
          액션은 탭 완료 시점(click/tap/pointerclick)에 — pointerdown은 iOS 실기기에서 신뢰 불가 */}
      <Group
        name="remove-button"
        x={closeX}
        y={closeY}
        onPointerDown={(e) => {
          e.evt.preventDefault();
          e.cancelBubble = true;
        }}
        onClick={handleRemoveTap}
        onTap={handleRemoveTap}
        onPointerClick={handleRemoveTap}
        onMouseEnter={() => {
          const c = groupRef.current?.getStage()?.container();
          if (c) c.style.cursor = "pointer";
        }}
      >
        {/* 시각 16px, 터치 히트는 24px — 44pt급 타깃 확보 */}
        <Circle radius={px(24)} fill="#000" opacity={0} />
        <Circle
          radius={px(16)}
          fill="#1c1c1e"
          shadowColor="rgba(0,0,0,0.3)"
          shadowBlur={px(4)}
          listening={false}
        />
        <Line
          points={[-px(5), -px(5), px(5), px(5)]}
          stroke="#ffffff"
          strokeWidth={px(2.2)}
          lineCap="round"
        />
        <Line
          points={[-px(5), px(5), px(5), -px(5)]}
          stroke="#ffffff"
          strokeWidth={px(2.2)}
          lineCap="round"
        />
      </Group>
      {/* 📷 교체 버튼은 DOM 오버레이(ReplaceButton) — iOS 파일 메뉴 앵커 때문.
          회전은 별도 핸들 없이 두 손가락 제스처가 담당한다 (기획 확정 2026-07-29) */}
    </Group>
  );
}
