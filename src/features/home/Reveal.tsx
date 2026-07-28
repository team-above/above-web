"use client";

import { useEffect, useRef, useState } from "react";

interface RevealProps {
  /** 스태거 지연 계산용 순서 */
  index: number;
  children: React.ReactNode;
}

/** 참고 시안의 카드 등장 — 뷰포트 진입 시 20px 상승 + 페이드 (스크롤 리빌) */
export function Reveal({ index, children }: RevealProps) {
  const ref = useRef<HTMLLIElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <li
      ref={ref}
      style={{ transitionDelay: shown ? `${index * 80}ms` : "0ms" }}
      className={`transition-[opacity,transform] duration-500 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
      }`}
    >
      {children}
    </li>
  );
}
