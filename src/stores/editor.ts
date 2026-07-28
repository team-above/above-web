/**
 * 에디터 상태 — 스펙 03. 서버 저장 없음(새로고침 시 초기화).
 * 사진은 슬롯 단위로 비율(variant)과 무관하게 공유하고, 배치 transform은 비율별로 독립 저장한다.
 */
import { create } from "zustand";
import type { PlacementAdjust } from "@/features/editor/transform";
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
  transforms: Record<VariantId, Record<string, PlacementAdjust>>;
  /** 슬롯별 회전(라디안) — 사진 속성이라 비율 간 공유된다 (스펙 05 변경 2026-07-28) */
  rotations: Record<string, number>;
  /** 지금 조작(드래그/핀치/휠) 중인 슬롯 — 슬롯 밖 고스트 표시용 */
  activeSlot: string | null;
  /** 하단 토스트 안내 (예: 저장 완료) — 라우트 이동에도 유지되도록 스토어에 둔다 */
  notice: string | null;
  /** 템플릿 진입 시 호출 — 다른 템플릿이면 전체 초기화 */
  enterTemplate: (templateId: string) => void;
  setVariant: (variant: VariantId) => void;
  setPhoto: (slotId: string, photo: SlotPhoto) => void;
  setTransform: (
    variant: VariantId,
    slotId: string,
    adjust: PlacementAdjust,
  ) => void;
  setRotation: (slotId: string, rotation: number) => void;
  setActiveSlot: (slotId: string | null) => void;
  setNotice: (message: string | null) => void;
  /** 에디터를 떠날 때(홈 복귀) 호출 — 전체 초기화. 에디터↔done 왕복은 유지된다 */
  reset: () => void;
}

const emptyTransforms = (): EditorState["transforms"] => ({
  post: {},
  story: {},
});

/** 비트맵 메모리를 반환하고 초기 상태 조각을 만든다 */
function releaseAndClear(state: { photos: Record<string, SlotPhoto> }) {
  for (const photo of Object.values(state.photos)) {
    photo.bitmap.close?.();
  }
  return {
    variant: "post" as const,
    photos: {},
    transforms: emptyTransforms(),
    rotations: {},
    activeSlot: null,
    notice: null,
  };
}

export const useEditorStore = create<EditorState>((set) => ({
  templateId: null,
  variant: "post",
  photos: {},
  transforms: emptyTransforms(),
  rotations: {},
  activeSlot: null,
  notice: null,
  enterTemplate: (templateId) =>
    set((state) =>
      state.templateId === templateId
        ? state
        : { templateId, ...releaseAndClear(state) },
    ),
  reset: () =>
    set((state) => ({ templateId: null, ...releaseAndClear(state) })),
  setActiveSlot: (slotId) => set({ activeSlot: slotId }),
  setNotice: (message) => set({ notice: message }),
  setVariant: (variant) => set({ variant }),
  setPhoto: (slotId, photo) =>
    set((state) => {
      state.photos[slotId]?.bitmap.close?.(); // 교체 시 기존 비트맵 메모리 반환
      return {
        photos: { ...state.photos, [slotId]: photo },
        // 사진이 바뀌면 배치·회전 모두 무효 — 제거해 cover·무회전 초기화 유도
        transforms: {
          post: omit(state.transforms.post, slotId),
          story: omit(state.transforms.story, slotId),
        },
        rotations: omit(state.rotations, slotId),
      };
    }),
  setTransform: (variant, slotId, adjust) =>
    set((state) => ({
      transforms: {
        ...state.transforms,
        [variant]: { ...state.transforms[variant], [slotId]: adjust },
      },
    })),
  setRotation: (slotId, rotation) =>
    set((state) => ({
      rotations: { ...state.rotations, [slotId]: rotation },
    })),
}));

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...record };
  delete rest[key];
  return rest;
}
