/**
 * 에디터 상태 — 스펙 03. 서버 저장 없음(새로고침 시 초기화).
 * 사진은 슬롯 단위로 비율(variant)과 무관하게 공유하고, 배치 transform은 비율별로 독립 저장한다.
 */
import { create } from "zustand";
import type { PhotoTransform } from "@/features/editor/transform";
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
  transforms: Record<VariantId, Record<string, PhotoTransform>>;
  /** 템플릿 진입 시 호출 — 다른 템플릿이면 전체 초기화 */
  enterTemplate: (templateId: string) => void;
  setVariant: (variant: VariantId) => void;
  setPhoto: (slotId: string, photo: SlotPhoto) => void;
  setTransform: (
    variant: VariantId,
    slotId: string,
    transform: PhotoTransform,
  ) => void;
}

const emptyTransforms = (): EditorState["transforms"] => ({
  post: {},
  story: {},
});

export const useEditorStore = create<EditorState>((set) => ({
  templateId: null,
  variant: "post",
  photos: {},
  transforms: emptyTransforms(),
  enterTemplate: (templateId) =>
    set((state) => {
      if (state.templateId === templateId) return state;
      // 이전 템플릿의 비트맵 메모리 반환
      for (const photo of Object.values(state.photos)) {
        photo.bitmap.close?.();
      }
      return {
        templateId,
        variant: "post",
        photos: {},
        transforms: emptyTransforms(),
      };
    }),
  setVariant: (variant) => set({ variant }),
  setPhoto: (slotId, photo) =>
    set((state) => {
      state.photos[slotId]?.bitmap.close?.(); // 교체 시 기존 비트맵 메모리 반환
      return {
        photos: { ...state.photos, [slotId]: photo },
        // 사진이 바뀌면 양쪽 비율의 기존 배치는 무효 — 제거해 cover 초기화 유도
        transforms: {
          post: omit(state.transforms.post, slotId),
          story: omit(state.transforms.story, slotId),
        },
      };
    }),
  setTransform: (variant, slotId, transform) =>
    set((state) => ({
      transforms: {
        ...state.transforms,
        [variant]: { ...state.transforms[variant], [slotId]: transform },
      },
    })),
}));

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...record };
  delete rest[key];
  return rest;
}
