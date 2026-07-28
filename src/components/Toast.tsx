"use client";

import { useEffect, useState } from "react";

interface ToastProps {
  /** null이면 퇴장 애니메이션 후 사라진다 */
  message: string | null;
  tone?: "success" | "error";
}

/** 하단 중앙 글래스 필 토스트 — 성공(잉크 체크)·에러(브랜드 오렌지 느낌표) */
export function Toast({ message, tone = "success" }: ToastProps) {
  // 렌더 시점 상태 조정 패턴 — message가 사라져도 퇴장 애니메이션 동안 마지막 문구를 유지한다
  const [last, setLast] = useState<string | null>(null);
  const [gone, setGone] = useState(true);
  if (message && message !== last) setLast(message);
  if (message && gone) setGone(false);
  const leaving = !message && !gone;

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setGone(true), 180);
    return () => clearTimeout(timer);
  }, [leaving]);

  if (!last || gone) return null;

  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-16 left-1/2 z-50 -translate-x-1/2"
    >
      <div
        className={`flex items-center gap-2 rounded-full bg-white/90 py-2 pr-4 pl-2 shadow-[0_8px_30px_rgba(0,0,0,0.16)] ring-1 ring-black/5 backdrop-blur-xl ${
          leaving
            ? "animate-[toast-out_0.18s_ease-in_both]"
            : "animate-[toast-in_0.35s_cubic-bezier(0.34,1.56,0.64,1)_both]"
        }`}
      >
        <span
          data-testid={`toast-icon-${tone}`}
          className={`flex size-6 items-center justify-center rounded-full text-white ${
            tone === "success" ? "bg-ink" : "bg-accent"
          }`}
        >
          {tone === "success" ? (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              aria-hidden
            >
              <line x1="12" y1="5" x2="12" y2="14" />
              <line x1="12" y1="19" x2="12" y2="19.01" />
            </svg>
          )}
        </span>
        <span className="text-ink text-[13px] font-semibold">{last}</span>
      </div>
    </div>
  );
}
