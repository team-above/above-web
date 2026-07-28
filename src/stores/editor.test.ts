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
    expect(next.focals).toEqual({});
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

  it("초점·회전·줌은 비율 간 공유되고, 사진 교체 시 초기화된다 (스펙 06)", () => {
    const store = useEditorStore.getState();
    store.setPhoto("left", { bitmap: fakeBitmap("a"), fileName: "a.jpg" });
    store.setFocal("left", { x: 25, y: -10 });
    store.setRotation("left", 0.7);
    store.setZoom("left", 1.8);
    store.setVariant("story");
    const shared = useEditorStore.getState();
    expect(shared.focals.left).toEqual({ x: 25, y: -10 }); // 전환에도 유지
    expect(shared.rotations.left).toBe(0.7);
    expect(shared.zooms.left).toBe(1.8);
    store.setPhoto("left", { bitmap: fakeBitmap("b"), fileName: "b.jpg" });
    const state = useEditorStore.getState();
    expect(state.focals.left).toBeUndefined(); // 교체 시 중앙
    expect(state.rotations.left).toBeUndefined(); // 교체 시 무회전
    expect(state.zooms.left).toBeUndefined(); // 교체 시 cover
  });

  it("사진 교체는 해당 슬롯의 편집 상태만 초기화한다 (다른 슬롯 불변)", () => {
    const store = useEditorStore.getState();
    store.setPhoto("left", { bitmap: fakeBitmap("a"), fileName: "a.jpg" });
    store.setFocal("left", { x: -10, y: 0 });
    store.setFocal("right", { x: -1, y: -1 });
    store.setPhoto("left", { bitmap: fakeBitmap("b"), fileName: "b.jpg" });
    const state = useEditorStore.getState();
    expect(state.photos.left.fileName).toBe("b.jpg");
    expect(state.focals.left).toBeUndefined();
    expect(state.focals.right).toEqual({ x: -1, y: -1 });
  });

  it("removePhoto는 사진·편집 상태를 지우고 선택도 해제한다 (✕ 버튼, 스펙 06)", () => {
    const close = vi.fn();
    const store = useEditorStore.getState();
    store.setPhoto("left", {
      bitmap: { width: 1, height: 1, close } as unknown as ImageBitmap,
      fileName: "a.jpg",
    });
    store.setPhoto("right", { bitmap: fakeBitmap("b"), fileName: "b.jpg" });
    store.setFocal("left", { x: 5, y: 5 });
    store.setRotation("left", 0.3);
    store.setZoom("left", 2);
    store.setSelectedSlot("left");
    store.removePhoto("left");
    const state = useEditorStore.getState();
    expect(close).toHaveBeenCalled(); // 비트맵 메모리 반환
    expect(state.photos.left).toBeUndefined();
    expect(state.focals.left).toBeUndefined();
    expect(state.rotations.left).toBeUndefined();
    expect(state.zooms.left).toBeUndefined();
    expect(state.selectedSlot).toBeNull();
    expect(state.photos.right).toBeDefined(); // 다른 슬롯 불변
    // 선택 중이 아닌 슬롯을 지워도 기존 선택은 유지된다
    store.setSelectedSlot("right");
    store.removePhoto("left"); // 이미 빈 슬롯 — 무해
    expect(useEditorStore.getState().selectedSlot).toBe("right");
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
