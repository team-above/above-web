"use client";

import { useEffect, useRef, useState } from "react";

interface RevealProps {
  /** 스태거 지연 계산용 순서 — 첫 진입 캐스케이드에만 쓰인다 */
  index: number;
  children: React.ReactNode;
}

/** 첫 페인트 직후로 판정하는 시간창 — 이 안의 리빌만 캐스케이드(스태거) 연출 */
const INITIAL_CASCADE_WINDOW_MS = 300;

/**
 * 참고 시안의 카드 등장 — 20px 상승 + 페이드.
 * 스크롤 노출이 느리다는 QA(2026-07-29) 반영: 뷰포트 아래 30% 바깥에서 미리 발동하고
 * 전환을 300ms로 단축, 스태거는 첫 진입 캐스케이드에만 적용(스크롤 리빌은 즉시).
 */
export function Reveal({ index, children }: RevealProps) {
  const ref = useRef<HTMLLIElement>(null);
  const mountedAt = useRef(0);
  const [delay, setDelay] = useState<number | null>(null); // null = 미노출

  useEffect(() => {
    mountedAt.current = performance.now();
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        const isInitialCascade =
          performance.now() - mountedAt.current < INITIAL_CASCADE_WINDOW_MS;
        setDelay(isInitialCascade ? index * 60 : 0);
        observer.disconnect();
      },
      // 화면 아래 30% 바깥에서 미리 발동 — 스크롤로 닿기 전에 이미 나타나 있게
      { rootMargin: "0px 0px 30% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [index]);

  const shown = delay !== null;
  return (
    <li
      ref={ref}
      style={{ transitionDelay: `${delay ?? 0}ms` }}
      className={`transition-[opacity,transform] duration-300 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
      }`}
    >
      {children}
    </li>
  );
}
