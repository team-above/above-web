import { beforeEach, describe, expect, it } from "vitest";
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
