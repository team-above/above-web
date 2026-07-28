/**
 * 에디터 상태 — 스펙 03/05/06. 서버 저장 없음(새로고침 시 초기화).
 * 초점(어느 부분을 보일지)·회전·줌은 슬롯 단위로 비율(variant)과 무관하게 공유한다 —
 * 비율을 전환해도 편집 상태가 그대로 따라온다.
 */
import { create } from "zustand";
import type { FocalPoint } from "@/features/editor/transform";
import type { VariantId } from "@/templates/schema";

export interface SlotPhoto {
  /** 디코딩 완료된 비트맵 (EXIF 보정·다운샘플 적용 후) */
  bitmap: ImageBitmap;
  fileName: string;
}

interface EditorState {
  templateId: string | null;
  variant: VariantId;
  photos: Record<string, SlotPhoto>;
  /** 슬롯별 초점(슬롯 중앙에 오는 사진 지점, 사진 좌표계) — 사진 속성, 비율 간 공유 */
  focals: Record<string, FocalPoint>;
  /** 슬롯별 회전(라디안) — 사진 속성, 비율 간 공유 */
  rotations: Record<string, number>;
  /** 슬롯별 줌(cover 대비 상대 배율 ≥1) — 사진 속성, 비율 간 공유 */
  zooms: Record<string, number>;
  /** 선택된 슬롯 — 테두리·고스트·오버레이 컨트롤 표시, 조작 허용 (스펙 06) */
  selectedSlot: string | null;
  /** 하단 토스트 안내 (예: 저장 완료) — 라우트 이동에도 유지되도록 스토어에 둔다 */
  notice: string | null;
  /** 템플릿 진입 시 호출 — 다른 템플릿이면 전체 초기화 */
  enterTemplate: (templateId: string) => void;
  setVariant: (variant: VariantId) => void;
  setPhoto: (slotId: string, photo: SlotPhoto) => void;
  setFocal: (slotId: string, focal: FocalPoint) => void;
  setRotation: (slotId: string, rotation: number) => void;
  setZoom: (slotId: string, zoom: number) => void;
  setSelectedSlot: (slotId: string | null) => void;
  setNotice: (message: string | null) => void;
  /** 에디터를 떠날 때(홈 복귀) 호출 — 전체 초기화. 에디터↔done 왕복은 유지된다 */
  reset: () => void;
}

/** 비트맵 메모리를 반환하고 초기 상태 조각을 만든다 */
function releaseAndClear(state: { photos: Record<string, SlotPhoto> }) {
  for (const photo of Object.values(state.photos)) {
    photo.bitmap.close?.();
  }
  return {
    variant: "post" as const,
    photos: {},
    focals: {},
    rotations: {},
    zooms: {},
    selectedSlot: null,
    notice: null,
  };
}

export const useEditorStore = create<EditorState>((set) => ({
  templateId: null,
  variant: "post",
  photos: {},
  focals: {},
  rotations: {},
  zooms: {},
  selectedSlot: null,
  notice: null,
  enterTemplate: (templateId) =>
    set((state) =>
      state.templateId === templateId
        ? state
        : { templateId, ...releaseAndClear(state) },
    ),
  reset: () =>
    set((state) => ({ templateId: null, ...releaseAndClear(state) })),
  // 비율 전환 시 선택 해제 (스펙 06)
  setVariant: (variant) => set({ variant, selectedSlot: null }),
  setSelectedSlot: (slotId) => set({ selectedSlot: slotId }),
  setNotice: (message) => set({ notice: message }),
  setPhoto: (slotId, photo) =>
    set((state) => {
      state.photos[slotId]?.bitmap.close?.(); // 교체 시 기존 비트맵 메모리 반환
      return {
        photos: { ...state.photos, [slotId]: photo },
        // 사진이 바뀌면 초점·회전·줌 모두 무효 — 제거해 cover·중앙·무회전 초기화 유도
        focals: omit(state.focals, slotId),
        rotations: omit(state.rotations, slotId),
        zooms: omit(state.zooms, slotId),
      };
    }),
  setFocal: (slotId, focal) =>
    set((state) => ({
      focals: { ...state.focals, [slotId]: focal },
    })),
  setRotation: (slotId, rotation) =>
    set((state) => ({
      rotations: { ...state.rotations, [slotId]: rotation },
    })),
  setZoom: (slotId, zoom) =>
    set((state) => ({
      zooms: { ...state.zooms, [slotId]: zoom },
    })),
}));

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...record };
  delete rest[key];
  return rest;
}
