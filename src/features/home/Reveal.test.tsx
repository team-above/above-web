import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reveal } from "./Reveal";

type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;

function stubIntersectionObserver() {
  let callback: IOCallback | null = null;
  let options: IntersectionObserverInit | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IOCallback, opts?: IntersectionObserverInit) {
        callback = cb;
        options = opts;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  return {
    fire: (isIntersecting: boolean) =>
      act(() => callback?.([{ isIntersecting }])),
    getOptions: () => options,
    disconnect,
  };
}

afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("Reveal", () => {
  it("첫 진입 캐스케이드: 즉시 노출되는 카드는 순서 스태거로 표시된다", () => {
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

    io.fire(true); // 마운트 직후(캐스케이드 시간창 안) 진입
    expect(li.className).toContain("opacity-100");
    expect(li.className).toContain("translate-y-0");
    expect(li.style.transitionDelay).toBe("120ms"); // index 2 × 60ms
    expect(io.disconnect).toHaveBeenCalled(); // 1회 리빌 후 관찰 해제
  });

  it("스크롤 리빌: 늦게 진입한 카드는 지연 없이 즉시 나타난다 (QA 2026-07-29)", () => {
    const io = stubIntersectionObserver();
    // 마운트 시각 0 → 진입 시각 1000ms (캐스케이드 시간창 밖)
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    render(
      <ul>
        <Reveal index={4}>
          <span>카드</span>
        </Reveal>
      </ul>,
    );
    clock = 1000;
    io.fire(true);
    const li = screen.getByRole("listitem");
    expect(li.className).toContain("opacity-100");
    expect(li.style.transitionDelay).toBe("0ms"); // 스태거 없음
  });

  it("뷰포트 아래 30% 바깥에서 미리 발동하도록 rootMargin을 준다", () => {
    const io = stubIntersectionObserver();
    render(
      <ul>
        <Reveal index={0}>
          <span>카드</span>
        </Reveal>
      </ul>,
    );
    expect(io.getOptions()?.rootMargin).toBe("0px 0px 30% 0px");
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
