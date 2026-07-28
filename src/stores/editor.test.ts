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
    expect(next.transforms).toEqual({ post: {}, story: {} });
  });

  it("비율 전환 시 사진과 비율별 조정값이 보존된다", () => {
    const store = useEditorStore.getState();
    store.setPhoto("left", { bitmap: fakeBitmap("a"), fileName: "a.jpg" });
    store.setTransform("post", "left", { x: -10, y: 0, scale: 1.5 });
    store.setVariant("story");
    store.setTransform("story", "left", { x: -99, y: -5, scale: 2 });
    const state = useEditorStore.getState();
    expect(state.photos.left.fileName).toBe("a.jpg");
    expect(state.transforms.post.left).toEqual({ x: -10, y: 0, scale: 1.5 });
    expect(state.transforms.story.left).toEqual({ x: -99, y: -5, scale: 2 });
  });

  it("reset은 전체 상태를 비우고 비트맵을 닫는다 (홈 복귀)", () => {
    const close = vi.fn();
    const store = useEditorStore.getState();
    store.setPhoto("left", {
      bitmap: { width: 1, height: 1, close } as unknown as ImageBitmap,
      fileName: "a.jpg",
    });
    store.setVariant("story");
    store.setActiveSlot("left");
    useEditorStore.getState().reset();
    const state = useEditorStore.getState();
    expect(close).toHaveBeenCalled();
    expect(state.templateId).toBeNull();
    expect(state.photos).toEqual({});
    expect(state.variant).toBe("post");
    expect(state.activeSlot).toBeNull();
    expect(state.exportUrl).toBeNull();
  });

  it("activeSlot을 설정·해제한다 (고스트 표시 트리거)", () => {
    useEditorStore.getState().setActiveSlot("left");
    expect(useEditorStore.getState().activeSlot).toBe("left");
    useEditorStore.getState().setActiveSlot(null);
    expect(useEditorStore.getState().activeSlot).toBeNull();
  });

  it("내보내기 URL 교체·템플릿 전환 시 이전 objectURL을 revoke한다", () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: revoke });
    const store = useEditorStore.getState();
    store.setExportUrl("blob:one");
    store.setExportUrl("blob:two");
    expect(revoke).toHaveBeenCalledWith("blob:one");
    useEditorStore.getState().enterTemplate("frame03");
    expect(revoke).toHaveBeenCalledWith("blob:two");
    expect(useEditorStore.getState().exportUrl).toBeNull();
    vi.unstubAllGlobals();
  });

  it("사진 교체 시 해당 슬롯의 양쪽 비율 조정값을 초기화한다", () => {
    const store = useEditorStore.getState();
    store.setPhoto("left", { bitmap: fakeBitmap("a"), fileName: "a.jpg" });
    store.setTransform("post", "left", { x: -10, y: 0, scale: 1.5 });
    store.setTransform("story", "left", { x: -20, y: 0, scale: 2 });
    store.setTransform("post", "right", { x: -1, y: -1, scale: 1.2 });
    store.setPhoto("left", { bitmap: fakeBitmap("b"), fileName: "b.jpg" });
    const state = useEditorStore.getState();
    expect(state.photos.left.fileName).toBe("b.jpg");
    expect(state.transforms.post.left).toBeUndefined();
    expect(state.transforms.story.left).toBeUndefined();
    expect(state.transforms.post.right).toEqual({ x: -1, y: -1, scale: 1.2 }); // 다른 슬롯 불변
  });
});
