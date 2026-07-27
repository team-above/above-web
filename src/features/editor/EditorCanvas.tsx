"use client";

import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Rect,
  Stage,
  Text,
} from "react-konva";
import { fitToViewport } from "@/lib/canvas-size";
import { useEditorStore } from "@/stores/editor";
import type { FrameTemplate, TemplatePlacement } from "@/templates/schema";
import { clampTransform, initialTransform, zoomAt } from "./transform";
import { useImageElement } from "./use-image";

/** 내보내기 함수 시그니처 — 메인 레이어를 캔버스 좌표계 네이티브 해상도로 래스터화 (스펙 04) */
export type ExportFn = () => HTMLCanvasElement | null;

interface EditorCanvasProps {
  template: FrameTemplate;
  /** 슬롯 탭(빈 슬롯 추가·재탭 교체 공통) → 파일 선택 트리거 */
  onSlotTap: (slotId: string) => void;
  /** EditorShell이 다운로드 시 호출할 내보내기 함수를 여기 담아준다 */
  exportRef: React.MutableRefObject<ExportFn | null>;
}

export default function EditorCanvas({
  template,
  onSlotTap,
  exportRef,
}: EditorCanvasProps) {
  const variant = useEditorStore((s) => s.variant);
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
  const fitted =
    viewport.width > 0 && viewport.height > 0
      ? fitToViewport(variant, viewport)
      : null;

  // 내보내기: 스테이지를 잠시 1:1 크기로 되돌려 메인 레이어만 래스터화 (UI 배지 레이어 제외)
  useEffect(() => {
    exportRef.current = () => {
      const stage = stageRef.current;
      if (!stage) return null;
      const prev = {
        scale: stage.scaleX(),
        width: stage.width(),
        height: stage.height(),
      };
      stage.scale({ x: 1, y: 1 });
      stage.size(variantData.canvas);
      const canvas = stage.getLayers()[0].toCanvas();
      stage.scale({ x: prev.scale, y: prev.scale });
      stage.size({ width: prev.width, height: prev.height });
      stage.batchDraw();
      return canvas;
    };
    return () => {
      exportRef.current = null;
    };
  }, [exportRef, variantData]);

  return (
    <div
      ref={containerRef}
      data-testid="editor-canvas"
      // touch-none: 캔버스 제스처(드래그/핀치)가 페이지 스크롤로 새지 않게
      className="flex min-h-0 w-full flex-1 touch-none items-center justify-center"
    >
      {fitted && base && (
        <Stage
          ref={stageRef}
          width={fitted.width}
          height={fitted.height}
          scaleX={fitted.scale}
          scaleY={fitted.scale}
        >
          <Layer>
            <KonvaImage image={base} listening={false} />
            {variantData.placements.map((placement) => (
              <PlacementNode
                key={placement.slot}
                placement={placement}
                onTap={() => onSlotTap(placement.slot)}
                stageScale={fitted.scale}
              />
            ))}
            {overlay && <KonvaImage image={overlay} listening={false} />}
          </Layer>
          <Layer listening={false}>
            {variantData.placements.map((placement) => (
              <EmptySlotBadge key={placement.slot} placement={placement} />
            ))}
          </Layer>
        </Stage>
      )}
    </div>
  );
}

/** 사진 없는 슬롯 중앙의 + 배지 (UI 전용 레이어 — 내보내기·시각 비교 대상 아님) */
function EmptySlotBadge({ placement }: { placement: TemplatePlacement }) {
  const hasPhoto = useEditorStore((s) => Boolean(s.photos[placement.slot]));
  if (hasPhoto) return null;
  const cx = placement.rect.x + placement.rect.width / 2;
  const cy = placement.rect.y + placement.rect.height / 2;
  return (
    <Group>
      <Circle x={cx} y={cy} radius={34} fill="rgba(255,255,255,0.92)" />
      <Text
        x={cx - 34}
        y={cy - 34}
        width={68}
        height={68}
        text="+"
        fontSize={40}
        fill="#333333"
        align="center"
        verticalAlign="middle"
      />
    </Group>
  );
}

interface PlacementNodeProps {
  placement: TemplatePlacement;
  onTap: () => void;
  stageScale: number;
}

interface GestureSession {
  pointers: Map<number, { x: number; y: number }>;
  /** 누적 이동량 (캔버스 좌표 단위) — 탭/드래그 판별 */
  moved: number;
  lastDist: number | null;
  cleanup: () => void;
}

/** 사진 + 마스크(destination-in) 합성과 탭/드래그/핀치 제스처를 담당하는 슬롯 노드 */
function PlacementNode({ placement, onTap, stageScale }: PlacementNodeProps) {
  const { rect } = placement;
  const variant = useEditorStore((s) => s.variant);
  const photo = useEditorStore((s) => s.photos[placement.slot]);
  const stored = useEditorStore((s) => s.transforms[variant][placement.slot]);
  const setTransform = useEditorStore((s) => s.setTransform);

  const mask = useImageElement(placement.mask);
  const groupRef = useRef<Konva.Group>(null);

  const photoSize = photo
    ? { width: photo.bitmap.width, height: photo.bitmap.height }
    : null;

  // 초기 배치(cover·중앙)는 스토어에 한 번만 기록한다 — 렌더마다 새 객체가 생기는 것 방지
  useEffect(() => {
    if (photoSize && !stored) {
      setTransform(variant, placement.slot, initialTransform(photoSize, rect));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoSize?.width, photoSize?.height, stored, variant, placement.slot]);

  // 마스크 합성(destination-in)은 그룹 캐시 안에서만 적용되어야 레이어 전체를 지우지 않는다
  const ready = Boolean(photo && mask && stored);
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    if (ready) {
      group.cache({ x: 0, y: 0, width: rect.width, height: rect.height });
    } else {
      group.clearCache();
    }
    group.getLayer()?.batchDraw();
    return () => {
      group.clearCache();
    };
  }, [ready, stored, rect.width, rect.height]);

  const sessionRef = useRef<GestureSession | null>(null);
  useEffect(() => () => sessionRef.current?.cleanup(), []);

  const toLocal = (clientX: number, clientY: number) => {
    const box = groupRef.current
      ?.getStage()
      ?.container()
      .getBoundingClientRect();
    return {
      x: (clientX - (box?.left ?? 0)) / stageScale - rect.x,
      y: (clientY - (box?.top ?? 0)) / stageScale - rect.y,
    };
  };

  const applyDrag = (dx: number, dy: number) => {
    if (!photoSize || !stored) return;
    setTransform(
      variant,
      placement.slot,
      clampTransform(
        { ...stored, x: stored.x + dx, y: stored.y + dy },
        photoSize,
        rect,
      ),
    );
  };

  const applyZoom = (factor: number, focus: { x: number; y: number }) => {
    if (!photoSize || !stored) return;
    setTransform(
      variant,
      placement.slot,
      zoomAt(stored, factor, focus, photoSize, rect),
    );
  };

  /**
   * 제스처 세션 — 시작한 슬롯이 끝까지 소유한다 (윈도우 리스너로 포인터 캡처 의미론).
   * 슬롯 밖으로 나가도 드래그가 이어지고, 이웃 슬롯 위에서 놓아도 그 슬롯이 탭으로 오인하지 않는다.
   */
  const startSession = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const point = { x: e.evt.clientX, y: e.evt.clientY };
    const existing = sessionRef.current;
    if (existing) {
      // 두 번째 손가락 → 핀치 모드 진입 (드래그로 오인 금지)
      existing.pointers.set(e.evt.pointerId, point);
      existing.lastDist = null;
      existing.moved = 99;
      return;
    }
    const pointers = new Map([[e.evt.pointerId, point]]);
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
      // 이동이 거의 없으면 탭 — 빈 슬롯은 추가, 사진 있으면 교체 (사용자 확정 A안)
      if (s.moved < 6) onTap();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    sessionRef.current = { pointers, moved: 0, lastDist: null, cleanup };
  };

  return (
    <Group ref={groupRef} x={rect.x} y={rect.y}>
      {/* 히트 영역 — 별무리처럼 마스크가 희소해도 rect 전체가 탭 대상 (스펙 03) */}
      <Rect
        width={rect.width}
        height={rect.height}
        opacity={0}
        fill="#000"
        onPointerDown={startSession}
        onWheel={(e) => {
          e.evt.preventDefault();
          applyZoom(
            Math.exp(-e.evt.deltaY * 0.002),
            toLocal(e.evt.clientX, e.evt.clientY),
          );
        }}
      />
      {ready && photoSize && stored && (
        <>
          <KonvaImage
            image={photo!.bitmap}
            x={stored.x}
            y={stored.y}
            width={photoSize.width * stored.scale}
            height={photoSize.height * stored.scale}
            listening={false}
          />
          <KonvaImage
            image={mask!}
            listening={false}
            globalCompositeOperation="destination-in"
          />
        </>
      )}
    </Group>
  );
}
