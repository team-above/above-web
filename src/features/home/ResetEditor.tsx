"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/stores/editor";

/**
 * 홈 진입 시 에디터 상태 초기화 — 에디터를 나갔다 다시 들어오면 처음부터 시작한다
 * (사용자 확정 2026-07-28). 에디터↔done 왕복은 홈을 거치지 않으므로 유지된다.
 */
export function ResetEditor() {
  useEffect(() => {
    useEditorStore.getState().reset();
  }, []);
  return null;
}
