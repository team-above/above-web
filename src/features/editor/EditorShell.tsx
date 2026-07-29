"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Toast } from "@/components/Toast";
import { useEditorStore } from "@/stores/editor";
import type { FrameTemplate, VariantId } from "@/templates/schema";
import type { ExportFn } from "./EditorCanvas";
import {
  canExport,
  dataUrlToBlob,
  exportFileName,
  shouldUseShareSheet,
} from "./export";
import { loadPhoto, PhotoLoadError } from "./photo-loader";

const EditorCanvas = dynamic(() => import("./EditorCanvas"), { ssr: false });

const RATIO_LABEL: Record<VariantId, string> = {
  post: "Post 4:5",
  story: "Story 9:16",
};

/** 파일 메뉴 앵커 — 탭한 슬롯의 화면(viewport) rect */
export interface SlotAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function EditorShell({ template }: { template: FrameTemplate }) {
  const router = useRouter();
  const variant = useEditorStore((s) => s.variant);
  const setVariant = useEditorStore((s) => s.setVariant);
  const enterTemplate = useEditorStore((s) => s.enterTemplate);
  const setPhoto = useEditorStore((s) => s.setPhoto);
  const setSelectedSlot = useEditorStore((s) => s.setSelectedSlot);
  const notice = useEditorStore((s) => s.notice);
  const setNotice = useEditorStore((s) => s.setNotice);
  const exportable = useEditorStore((s) => canExport(s.photos));

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<string | null>(null);
  const exportRef = useRef<ExportFn | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    enterTemplate(template.id);
  }, [enterTemplate, template.id]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error]);

  // 저장 완료 토스트 — done 라우트 왕복(리마운트) 후에도 보이도록 스토어 기반
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  const handleSlotTap = (slotId: string, anchor?: SlotAnchor) => {
    pendingSlotRef.current = slotId;
    const input = fileInputRef.current;
    if (!input) return;
    // iOS는 파일 메뉴를 input 요소 rect에 앵커링한다 — 크기 없는 앵커면 원형 폴백 판이
    // 그려지므로, 탭한 슬롯의 화면 rect에 input을 겹쳐 메뉴가 슬롯에서 펼쳐지게 한다
    if (anchor) {
      input.style.left = `${anchor.x}px`;
      input.style.top = `${anchor.y}px`;
      input.style.width = `${Math.max(anchor.width, 1)}px`;
      input.style.height = `${Math.max(anchor.height, 1)}px`;
    }
    input.click();
  };

  const handleFile = async (file: File | undefined) => {
    const slotId = pendingSlotRef.current;
    pendingSlotRef.current = null;
    if (!file || !slotId) return;
    try {
      setPhoto(slotId, await loadPhoto(file));
      setSelectedSlot(slotId); // 첨부 직후 자동 선택 — 바로 조정 가능 (스펙 06)
    } catch (cause) {
      setError(
        cause instanceof PhotoLoadError
          ? cause.message
          : "사진을 불러오지 못했어요",
      );
    }
  };

  // 저장 완료 처리 — 토스트는 실제로 저장 플로우가 끝났을 때만 (기획 확정 2026-07-29)
  const markSaved = () => {
    setNotice("저장했어요");
    // 집계 전용 무화면 라우트 경유 — 페이지뷰만 남기고 즉시 에디터로 복귀 (스펙 04 변경)
    router.push(`/editor/${template.id}/done`);
  };

  const downloadViaAnchor = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor); // 일부 브라우저는 DOM 밖 앵커 클릭을 무시
    anchor.click();
    anchor.remove();
    // 다운로드 시작 후 여유를 두고 반환 (즉시 revoke하면 일부 브라우저에서 다운로드가 끊긴다)
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    markSaved();
  };

  const handleDownload = () => {
    const canvas = exportRef.current?.();
    if (!canvas) {
      // 비율 전환 직후 등 에셋 로딩 중 — 무음 실패 방지
      setError("캔버스를 준비하고 있어요. 잠시 후 다시 시도해 주세요");
      return;
    }
    const fileName = exportFileName(template.id, variant);
    // iOS는 시스템 공유 시트(사진 저장 포함)로 — 앵커는 갤러리로 가지 않는다.
    // share()는 사용자 제스처와 같은 태스크에서 불러야 해서 동기(toDataURL) 경로를 쓴다
    if (
      shouldUseShareSheet(
        navigator.userAgent,
        navigator.maxTouchPoints,
        typeof navigator.canShare === "function",
      )
    ) {
      const blob = dataUrlToBlob(canvas.toDataURL("image/png"));
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        navigator
          .share({ files: [file] })
          .then(markSaved) // 시트에서 저장/공유를 마친 경우에만 토스트
          .catch((cause: unknown) => {
            if ((cause as DOMException)?.name === "AbortError") return; // 시트 닫음 — 무음
            downloadViaAnchor(blob, fileName); // 공유 실패 폴백
          });
      } else {
        downloadViaAnchor(blob, fileName); // 파일 공유 불가 환경(인앱 등) 폴백
      }
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("이미지를 만들지 못했어요. 다시 시도해 주세요");
        return;
      }
      downloadViaAnchor(blob, fileName);
    }, "image/png");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 참고 시안: 48px 풀블리드 반투명 블러 바 + 0.5px 헤어라인 */}
      <header className="bg-surface/85 relative flex h-12 shrink-0 items-center justify-between border-b-[0.5px] border-black/10 pr-3 pl-2 backdrop-blur-[20px]">
        <Link
          href="/"
          className="text-ink flex items-center gap-0.5 text-base font-normal"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          Home
        </Link>
        <h1 className="text-ink absolute left-1/2 -translate-x-1/2 text-[15px] font-semibold">
          {template.name}
        </h1>
        <button
          type="button"
          onClick={handleDownload}
          disabled={!exportable}
          aria-label="다운로드"
          title={exportable ? "PNG로 저장" : "사진을 넣으면 저장할 수 있어요"}
          className={exportable ? "text-ink" : "text-ink opacity-25"}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" x2="12" y1="15" y2="3" />
          </svg>
        </button>
      </header>

      <div className="flex justify-center pt-4 pb-4">
        <div className="flex rounded-full bg-[rgba(118,118,128,0.12)] p-0.5">
          {(Object.keys(RATIO_LABEL) as VariantId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setVariant(id)}
              className={
                variant === id
                  ? "text-ink rounded-full bg-white px-4.5 py-[5px] text-[13px] font-semibold shadow-[0_1px_4px_rgba(0,0,0,0.12)]"
                  : "text-muted rounded-full px-4.5 py-[5px] text-[13px] font-normal"
              }
            >
              {RATIO_LABEL[id]}
            </button>
          ))}
        </div>
      </div>

      <EditorCanvas
        template={template}
        onSlotTap={handleSlotTap}
        exportRef={exportRef}
      />

      {/* display:none이면 iOS Safari가 파일 메뉴 앵커를 못 잡아 원형 폴백 판을 그린다 —
          시각적으로만 숨기고, 클릭 직전에 handleSlotTap이 탭한 슬롯 rect 위로 옮겨 앵커링한다 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="pointer-events-none fixed bottom-0 left-1/2 h-px w-px opacity-0"
        tabIndex={-1}
        aria-hidden
        data-testid="photo-input"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = ""; // 같은 파일 재선택(교체) 허용
        }}
      />

      <Toast message={error ?? notice} tone={error ? "error" : "success"} />
    </div>
  );
}
