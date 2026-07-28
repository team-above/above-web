import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "./editor";

const fakeBitmap = (name: string) =>
  ({ width: 100, height: 100, name }) as unknown as ImageBitmap;

describe("editor 스토어", () => {
  beforeEach(() => {
    useEditorStore.getState().enterTemplate("frame01");
  });

  it("템플릿 진입 시 초기화되고, 같은 템플릿 재진입은 상태를 유지한다", () => {
    const store = useEditorStore.getState();
    store.setPhoto("left", { bitmap: fakeBitmap("a"), fileName: "a.jpg" });
    useEditorStore.getState().enterTemplate("frame01"); // 같은 템플릿
    expect(useEditorStore.getState().photos.left).toBeDefined();
    useEditorStore.getState().enterTemplate("frame02"); // 다른 템플릿
    const next = useEditorStore.getState();
    expect(next.photos).toEqual({});
    expect(next.variant).toBe("post");
    expect(next.offsets).toEqual({ post: {}, story: {} });
    expect(next.zooms).toEqual({});
    expect(next.selectedSlot).toBeNull();
  });

  it("reset은 전체 상태를 비우고 비트맵을 닫는다 (홈 복귀)", () => {
    const close = vi.fn();
    const store = useEditorStore.getState();
    store.setPhoto("left", {
      bitmap: { width: 1, height: 1, close } as unknown as ImageBitmap,
      fileName: "a.jpg",
    });
    store.setVariant("story");
    store.setSelectedSlot("left");
    useEditorStore.getState().reset();
    const state = useEditorStore.getState();
    expect(close).toHaveBeenCalled();
    expect(state.templateId).toBeNull();
    expect(state.photos).toEqual({});
    expect(state.variant).toBe("post");
    expect(state.selectedSlot).toBeNull();
    expect(state.notice).toBeNull();
  });

  it("회전·줌은 비율 간 공유되고, 사진 교체 시 초기화된다 (스펙 06)", () => {
    const store = useEditorStore.getState();
    store.setPhoto("left", { bitmap: fakeBitmap("a"), fileName: "a.jpg" });
    store.setRotation("left", 0.7);
    store.setZoom("left", 1.8);
    store.setVariant("story");
    expect(useEditorStore.getState().rotations.left).toBe(0.7); // 전환에도 유지
    expect(useEditorStore.getState().zooms.left).toBe(1.8);
    store.setPhoto("left", { bitmap: fakeBitmap("b"), fileName: "b.jpg" });
    const state = useEditorStore.getState();
    expect(state.rotations.left).toBeUndefined(); // 교체 시 무회전
    expect(state.zooms.left).toBeUndefined(); // 교체 시 cover
  });

  it("오프셋은 비율별 독립 저장된다", () => {
    const store = useEditorStore.getState();
    store.setPhoto("left", { bitmap: fakeBitmap("a"), fileName: "a.jpg" });
    store.setOffset("post", "left", { x: -10, y: 0 });
    store.setVariant("story");
    store.setOffset("story", "left", { x: -99, y: -5 });
    const state = useEditorStore.getState();
    expect(state.photos.left.fileName).toBe("a.jpg");
    expect(state.offsets.post.left).toEqual({ x: -10, y: 0 });
    expect(state.offsets.story.left).toEqual({ x: -99, y: -5 });
  });

  it("사진 교체 시 해당 슬롯의 양쪽 비율 오프셋을 초기화한다", () => {
    const store = useEditorStore.getState();
    store.setPhoto("left", { bitmap: fakeBitmap("a"), fileName: "a.jpg" });
    store.setOffset("post", "left", { x: -10, y: 0 });
    store.setOffset("story", "left", { x: -20, y: 0 });
    store.setOffset("post", "right", { x: -1, y: -1 });
    store.setPhoto("left", { bitmap: fakeBitmap("b"), fileName: "b.jpg" });
    const state = useEditorStore.getState();
    expect(state.photos.left.fileName).toBe("b.jpg");
    expect(state.offsets.post.left).toBeUndefined();
    expect(state.offsets.story.left).toBeUndefined();
    expect(state.offsets.post.right).toEqual({ x: -1, y: -1 }); // 다른 슬롯 불변
  });

  it("선택은 토글 가능하고 비율 전환 시 자동 해제된다 (스펙 06)", () => {
    const store = useEditorStore.getState();
    store.setSelectedSlot("left");
    expect(useEditorStore.getState().selectedSlot).toBe("left");
    store.setVariant("story");
    expect(useEditorStore.getState().selectedSlot).toBeNull();
    store.setSelectedSlot("right");
    store.setSelectedSlot(null);
    expect(useEditorStore.getState().selectedSlot).toBeNull();
  });
});
