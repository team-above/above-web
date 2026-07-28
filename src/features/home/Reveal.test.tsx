import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reveal } from "./Reveal";

type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;

function stubIntersectionObserver() {
  let callback: IOCallback | null = null;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IOCallback) {
        callback = cb;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  return {
    fire: (isIntersecting: boolean) =>
      act(() => callback?.([{ isIntersecting }])),
    disconnect,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Reveal", () => {
  it("뷰포트 진입 전에는 숨김(translate+투명), 진입 시 표시 + 스태거 지연", () => {
    const io = stubIntersectionObserver();
    render(
      <ul>
        <Reveal index={2}>
          <span>카드</span>
        </Reveal>
      </ul>,
    );
    const li = screen.getByRole("listitem");
    expect(li.className).toContain("opacity-0");
    expect(li.className).toContain("translate-y-5");
    expect(li.style.transitionDelay).toBe("0ms");

    io.fire(true);
    expect(li.className).toContain("opacity-100");
    expect(li.className).toContain("translate-y-0");
    expect(li.style.transitionDelay).toBe("160ms"); // index 2 × 80ms
    expect(io.disconnect).toHaveBeenCalled(); // 1회 리빌 후 관찰 해제
  });

  it("진입하지 않으면 숨김 상태를 유지한다", () => {
    const io = stubIntersectionObserver();
    render(
      <ul>
        <Reveal index={0}>
          <span>카드</span>
        </Reveal>
      </ul>,
    );
    io.fire(false);
    expect(screen.getByRole("listitem").className).toContain("opacity-0");
  });
});
