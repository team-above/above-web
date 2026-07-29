"use client";

import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Path,
  Rect,
  Stage,
  Text,
} from "react-konva";
import { fitToViewport } from "@/lib/canvas-size";
import { useEditorStore } from "@/stores/editor";
import type { FrameTemplate, TemplatePlacement } from "@/templates/schema";
import {
  clampTransform,
  composeTransform,
  rotateTo,
  toFocal,
  toZoom,
  zoomAt,
  type PhotoTransform,
  type Size,
} from "./transform";
import type { SlotAnchor } from "./EditorShell";
import { useImageElement } from "./use-image";

/** 내보내기 함수 시그니처 — 메인 레이어를 캔버스 좌표계 네이티브 해상도로 래스터화 (스펙 04) */
export type ExportFn = () => HTMLCanvasElement | null;

/** 파일 선택 트리거 — anchor는 iOS 파일 메뉴가 펼쳐질 슬롯의 화면 rect */
type SlotTapHandler = (slotId: string, anchor?: SlotAnchor) => void;

interface EditorCanvasProps {
  template: FrameTemplate;
  /** 빈 슬롯 탭·교체(📷) 공통 — 파일 선택 트리거 */
  onSlotTap: SlotTapHandler;
  /** EditorShell이 다운로드 시 호출할 내보내기 함수를 여기 담아준다 */
  exportRef: React.MutableRefObject<ExportFn | null>;
}

/** 캔버스 rect → 화면(viewport) rect — iOS 파일 메뉴 앵커용 */
function slotAnchorFor(
  node: Konva.Node | null,
  rect: { x: number; y: number; width: number; height: number },
  stageScale: number,
): SlotAnchor | undefined {
  const box = node?.getStage()?.container().getBoundingClientRect();
  if (!box) return undefined;
  return {
    x: box.left + rect.x * stageScale,
    y: box.top + rect.y * stageScale,
    width: rect.width * stageScale,
    height: rect.height * stageScale,
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
  const setSelectedSlot = useEditorStore((s) => s.setSelectedSlot);
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

  // 내보내기: 스테이지를 잠시 1:1 크기로 되돌려 메인 레이어만 래스터화 (UI·선택 레이어 제외)
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
    <div data-testid="editor-canvas" className="flex min-h-0 w-full flex-1 p-4">
      {/* 안쪽 div가 측정 기준 — 바깥 p-4가 프레임 카드 그림자의 숨쉴 공간 */}
      <div
        ref={containerRef}
        // touch-none: 캔버스 제스처(드래그/핀치)가 페이지 스크롤로 새지 않게
        className="flex h-full w-full touch-none items-center justify-center"
      >
        {fitted && base && (
          <div className="overflow-hidden rounded-lg bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_8px_32px_rgba(0,0,0,0.18)]">
            <Stage
              ref={stageRef}
              width={fitted.width}
              height={fitted.height}
              scaleX={fitted.scale}
              scaleY={fitted.scale}
            >
              <Layer>
                {/* base가 배경 탭을 받아 선택 해제 (슬롯이 위에서 우선한다).
                    onTap은 iOS 실기기에서 pointer 이벤트가 유실될 때의 터치 폴백 */}
                <KonvaImage
                  image={base}
                  onPointerDown={() => setSelectedSlot(null)}
                  onTap={() => setSelectedSlot(null)}
                />
                {variantData.placements.map((placement) => (
                  <PlacementNode
                    key={placement.slot}
                    placement={placement}
                    onSlotTap={onSlotTap}
                    stageScale={fitted.scale}
                  />
                ))}
                {overlay && <KonvaImage image={overlay} listening={false} />}
              </Layer>
              {/* UI 레이어 — 내보내기·시각 회귀 비교 대상이 아니다 */}
              <Layer listening={false}>
                {variantData.placements.map((placement) => (
                  <GhostPhoto key={placement.slot} placement={placement} />
                ))}
                {variantData.placements.map((placement) => (
                  <EmptySlotBadge key={placement.slot} placement={placement} />
                ))}
              </Layer>
              {/* 선택 컨트롤 레이어 — 역시 내보내기 제외, 버튼은 탭 가능 */}
              <Layer>
                <SelectionControls
                  variantData={variantData}
                  stageScale={fitted.scale}
                  onReplace={onSlotTap}
                />
              </Layer>
            </Stage>
          </div>
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
  onSlotTap: SlotTapHandler;
  stageScale: number;
}

interface GestureSession {
  pointers: Map<number, { x: number; y: number }>;
  /** 누적 이동량 (캔버스 좌표 단위) — 탭/드래그 판별 */
  moved: number;
  lastDist: number | null;
  cleanup: () => void;
}

/** 사진 + 마스크(destination-in) 합성과 탭(선택)/드래그/핀치 제스처를 담당하는 슬롯 노드 */
function PlacementNode({
  placement,
  onSlotTap,
  stageScale,
}: PlacementNodeProps) {
  const { rect } = placement;
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
  }, [
    ready,
    stored?.x,
    stored?.y,
    stored?.scale,
    stored?.rotation,
    rect.width,
    rect.height,
  ]);

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
      // 이동이 거의 없으면 탭 — 사진은 선택 토글, 빈 슬롯은 파일 선택 (스펙 06)
      if (s.moved < 6) {
        if (photo) {
          setSelectedSlot(selected ? null : placement.slot);
        } else {
          onSlotTap(
            placement.slot,
            slotAnchorFor(groupRef.current, rect, stageScale),
          );
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

/** lucide 아이콘 패스 (24×24 기준) */
const CAMERA_PATHS = [
  "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",
  "M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
];
const ROTATE_PATHS = [
  "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8",
  "M21 3v5h-5",
];

interface SelectionControlsProps {
  variantData: FrameTemplate["variants"]["post"];
  stageScale: number;
  onReplace: SlotTapHandler;
}

/** 선택 테두리 + ✕(사진 삭제)·📷(교체)·⟳(궤도 회전 핸들) 오버레이 (스펙 06) */
function SelectionControls({
  variantData,
  stageScale,
  onReplace,
}: SelectionControlsProps) {
  const selected = useEditorStore((s) => s.selectedSlot);
  const photo = useEditorStore((s) =>
    selected ? s.photos[selected] : undefined,
  );
  const focal = useEditorStore((s) =>
    selected ? s.focals[selected] : undefined,
  );
  const rotation = useEditorStore((s) =>
    selected ? (s.rotations[selected] ?? 0) : 0,
  );
  const zoom = useEditorStore((s) => (selected ? (s.zooms[selected] ?? 1) : 1));
  const removePhoto = useEditorStore((s) => s.removePhoto);
  const setSelectedSlot = useEditorStore((s) => s.setSelectedSlot);
  const groupRef = useRef<Konva.Group>(null);
  const rotateSession = useRef<{ cleanup: () => void } | null>(null);
  const gestureSession = useRef<GestureSession | null>(null);
  useEffect(
    () => () => {
      rotateSession.current?.cleanup();
      gestureSession.current?.cleanup();
    },
    [],
  );

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
  const photoSize = { width: photo.bitmap.width, height: photo.bitmap.height };
  // 제스처 표면 배치용 — 메인 레이어의 사진과 같은 변환
  const stored = composeTransform(
    focal ?? null,
    zoom,
    rotation,
    photoSize,
    rect,
  );
  const drawnW = photoSize.width * stored.scale;
  const drawnH = photoSize.height * stored.scale;
  const { width: canvasW, height: canvasH } = variantData.canvas;
  /** 화면 픽셀 크기 고정용 — 스테이지 스케일 역산 */
  const px = (n: number) => n / stageScale;
  const clampX = (v: number) => Math.min(Math.max(v, px(22)), canvasW - px(22));
  const clampY = (v: number) => Math.min(Math.max(v, px(22)), canvasH - px(22));

  const closeX = clampX(rect.x + rect.width);
  const closeY = clampY(rect.y);
  // 📷는 슬롯 아래 바깥 — 작은 슬롯에서 사진 위 탭/드래그를 가리지 않는다 (⟳와 대칭)
  const cameraX = clampX(rect.x + rect.width / 2);
  const cameraY = clampY(rect.y + rect.height + px(32));
  const rotateX = clampX(rect.x + rect.width / 2);
  const rotateY = clampY(rect.y - px(32));

  /**
   * 궤도 회전 — 핸들을 잡고 슬롯 중심을 축으로 원을 그리듯 드래그.
   * pointer/touch 양쪽에서 시작·추적한다 (iOS 실기기의 pointer 이벤트 유실 대비).
   * 절대 각도 계산이라 두 경로가 겹쳐 와도 결과는 같다.
   */
  const startOrbit = (e: Konva.KonvaEventObject<PointerEvent | TouchEvent>) => {
    e.evt.preventDefault();
    e.cancelBubble = true;
    if (rotateSession.current) return; // pointer·touch 중복 시작 방지
    const stage = groupRef.current?.getStage();
    const box = stage?.container().getBoundingClientRect();
    if (!box) return;
    const startPoint =
      "touches" in e.evt ? e.evt.touches[0] : (e.evt as PointerEvent);
    if (!startPoint) return;
    const center = {
      x: box.left + (rect.x + rect.width / 2) * stageScale,
      y: box.top + (rect.y + rect.height / 2) * stageScale,
    };
    const startPointer = Math.atan2(
      startPoint.clientY - center.y,
      startPoint.clientX - center.x,
    );
    const startRotation = useEditorStore.getState().rotations[selected] ?? 0;
    const applyAngle = (clientX: number, clientY: number) => {
      const angle = Math.atan2(clientY - center.y, clientX - center.x);
      applySlotUpdate(selected, rect, (current, size) =>
        rotateTo(current, startRotation + (angle - startPointer), size, rect),
      );
    };
    const onMove = (ev: PointerEvent) => applyAngle(ev.clientX, ev.clientY);
    const onTouchMove = (ev: TouchEvent) => {
      const t = ev.touches[0];
      if (t) applyAngle(t.clientX, t.clientY);
    };
    const onUp = () => {
      rotateSession.current?.cleanup();
      rotateSession.current = null;
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onUp);
    window.addEventListener("touchcancel", onUp);
    rotateSession.current = { cleanup };
  };

  /** 클라이언트 좌표 → 캔버스 좌표 */
  const toCanvas = (clientX: number, clientY: number) => {
    const box = groupRef.current
      ?.getStage()
      ?.container()
      .getBoundingClientRect();
    return {
      x: (clientX - (box?.left ?? 0)) / stageScale,
      y: (clientY - (box?.top ?? 0)) / stageScale,
    };
  };

  const setCursor = (cursor: string) => {
    const c = groupRef.current?.getStage()?.container();
    if (c) c.style.cursor = cursor;
  };

  /**
   * 제스처 표면 탭 — 표면이 슬롯·배경을 덮으므로, 탭한 지점 아래의 슬롯 기준으로
   * 기존 탭 의미를 그대로 재현한다 (재탭=해제, 다른 사진=선택 전환, 빈 슬롯=첨부, 배경=해제)
   */
  const handleSurfaceTap = (clientX: number, clientY: number) => {
    const p = toCanvas(clientX, clientY);
    const hit = variantData.placements.find(
      (pl) =>
        p.x >= pl.rect.x &&
        p.x <= pl.rect.x + pl.rect.width &&
        p.y >= pl.rect.y &&
        p.y <= pl.rect.y + pl.rect.height,
    );
    const state = useEditorStore.getState();
    if (!hit || hit.slot === selected) {
      setSelectedSlot(null); // 배경(고스트 포함) 또는 재탭 → 해제
    } else if (state.photos[hit.slot]) {
      setSelectedSlot(hit.slot); // 다른 사진 → 선택 전환
    } else {
      // 빈 슬롯 → 파일 선택 (기존 동작)
      onReplace(
        hit.slot,
        slotAnchorFor(groupRef.current, hit.rect, stageScale),
      );
    }
  };

  /**
   * 제스처 표면 세션 — 선택된 사진의 전체 바운딩 박스(고스트 영역 포함)에서
   * 드래그/핀치를 받는다 (기획 요청 2026-07-29: 터치 영역을 슬롯 크기로 제한하지 말 것)
   */
  const startGesture = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    const point = { x: e.evt.clientX, y: e.evt.clientY };
    const existing = gestureSession.current;
    if (existing) {
      // 두 번째 손가락 → 핀치 모드 진입 (드래그·탭 오인 금지)
      existing.pointers.set(e.evt.pointerId, point);
      existing.lastDist = null;
      existing.moved = 99;
      return;
    }
    const pointers = new Map([[e.evt.pointerId, point]]);
    setCursor("grabbing");
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
        const [a, b] = [...s.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (s.lastDist !== null && s.lastDist > 0) {
          const mid = toCanvas((a.x + b.x) / 2, (a.y + b.y) / 2);
          const factor = dist / s.lastDist;
          applySlotUpdate(selected, rect, (current, size) =>
            zoomAt(
              current,
              factor,
              { x: mid.x - rect.x, y: mid.y - rect.y },
              size,
              rect,
            ),
          );
        }
        s.lastDist = dist;
      }
    };
    const onUp = (ev: PointerEvent) => {
      const s = gestureSession.current;
      if (!s || !s.pointers.has(ev.pointerId)) return;
      s.pointers.delete(ev.pointerId);
      s.lastDist = null;
      if (s.pointers.size > 0) return;
      s.cleanup();
      gestureSession.current = null;
      setCursor("grab");
      if (s.moved < 6) handleSurfaceTap(ev.clientX, ev.clientY);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    gestureSession.current = { pointers, moved: 0, lastDist: null, cleanup };
  };

  /** ✕ — 선택된 사진 삭제 (탭 완료 시점, 합성 이벤트 중복 방어) */
  const handleRemoveTap = () => {
    if (!fireOnce("remove")) return;
    removePhoto(selected);
  };

  /** 📷 — 사진 교체: 파일 메뉴가 슬롯에서 펼쳐지도록 앵커를 함께 넘긴다 */
  const handleReplaceTap = () => {
    if (!fireOnce("replace")) return;
    onReplace(selected, slotAnchorFor(groupRef.current, rect, stageScale));
  };

  const iconScale = px(15) / 24;

  return (
    <Group ref={groupRef}>
      {/* 제스처 표면 — 슬롯 밖으로 잘려 보이는 원본(고스트) 영역까지 드래그/핀치/휠을 받는다 */}
      <Rect
        name="gesture-surface"
        x={rect.x + rect.width / 2 + stored.x}
        y={rect.y + rect.height / 2 + stored.y}
        offsetX={drawnW / 2}
        offsetY={drawnH / 2}
        width={drawnW}
        height={drawnH}
        rotation={(stored.rotation * 180) / Math.PI}
        opacity={0}
        fill="#000"
        onPointerDown={startGesture}
        onWheel={(e) => {
          e.evt.preventDefault();
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
      {/* 📷 교체 (슬롯 아래) — 탭 완료 시점에 실행해야 iOS가 파일 선택창을 허용한다
          (터치의 user activation은 pointerup/touchend에 부여, pointerdown 시점엔 없음) */}
      <Group
        name="replace-button"
        x={cameraX}
        y={cameraY}
        onPointerDown={(e) => {
          e.evt.preventDefault();
          e.cancelBubble = true;
        }}
        onClick={handleReplaceTap}
        onTap={handleReplaceTap}
        onPointerClick={handleReplaceTap}
        onMouseEnter={() => {
          const c = groupRef.current?.getStage()?.container();
          if (c) c.style.cursor = "pointer";
        }}
      >
        <Circle radius={px(24)} fill="#000" opacity={0} />
        <Circle
          radius={px(18)}
          fill="#ffffff"
          shadowColor="rgba(0,0,0,0.25)"
          shadowBlur={px(5)}
          listening={false}
        />
        {CAMERA_PATHS.map((data) => (
          <Path
            key={data}
            data={data}
            x={-12 * iconScale}
            y={-12 * iconScale}
            scaleX={iconScale}
            scaleY={iconScale}
            stroke="#1c1c1e"
            strokeWidth={2}
            lineCap="round"
            lineJoin="round"
          />
        ))}
      </Group>
      {/* ⟳ 궤도 회전 핸들 (상단 중앙) — 드래그 시작이므로 down 시점 유지, touch 폴백 병행 */}
      <Group
        name="rotate-handle"
        x={rotateX}
        y={rotateY}
        onPointerDown={startOrbit}
        onTouchStart={startOrbit}
        onMouseEnter={() => {
          const c = groupRef.current?.getStage()?.container();
          if (c) c.style.cursor = "grab";
        }}
      >
        <Circle radius={px(24)} fill="#000" opacity={0} />
        <Circle
          radius={px(16)}
          fill="#ffffff"
          shadowColor="rgba(0,0,0,0.25)"
          shadowBlur={px(5)}
          listening={false}
        />
        {ROTATE_PATHS.map((data) => (
          <Path
            key={data}
            data={data}
            x={-12 * iconScale}
            y={-12 * iconScale}
            scaleX={iconScale}
            scaleY={iconScale}
            stroke="#1c1c1e"
            strokeWidth={2.4}
            lineCap="round"
            lineJoin="round"
          />
        ))}
      </Group>
    </Group>
  );
}
