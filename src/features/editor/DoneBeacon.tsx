"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * 다운로드 집계 전용 무화면 라우트 (스펙 04 변경 2026-07-28 — 결과 화면 제거).
 * 이 라우트의 페이지뷰가 전환율(1차 지표)의 분자로 남고, 사용자는 즉시 에디터로 복귀한다.
 */
export function DoneBeacon({ frameId }: { frameId: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/editor/${frameId}`);
  }, [router, frameId]);
  return null;
}
