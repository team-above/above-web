"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Toast } from "@/components/Toast";
import { useEditorStore } from "@/stores/editor";
import type { FrameTemplate, VariantId } from "@/templates/schema";
import type { ExportFn } from "./EditorCanvas";
import { canExport, exportFileName } from "./export";
import { loadPhoto, PhotoLoadError } from "./photo-loader";

const EditorCanvas = dynamic(() => import("./EditorCanvas"), { ssr: false });

const RATIO_LABEL: Record<VariantId, string> = {
  post: "Post 4:5",
  story: "Story 9:16",
};

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

  const handleSlotTap = (slotId: string) => {
    pendingSlotRef.current = slotId;
    fileInputRef.current?.click();
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

  const handleDownload = () => {
    const canvas = exportRef.current?.();
    if (!canvas) {
      // 비율 전환 직후 등 에셋 로딩 중 — 무음 실패 방지
      setError("캔버스를 준비하고 있어요. 잠시 후 다시 시도해 주세요");
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("이미지를 만들지 못했어요. 다시 시도해 주세요");
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exportFileName(template.id, variant);
      document.body.appendChild(anchor); // 일부 브라우저는 DOM 밖 앵커 클릭을 무시
      anchor.click();
      anchor.remove();
      // 다운로드 시작 후 여유를 두고 반환 (즉시 revoke하면 일부 브라우저에서 다운로드가 끊긴다)
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNotice("저장했어요");
      // 집계 전용 무화면 라우트 경유 — 페이지뷰만 남기고 즉시 에디터로 복귀 (스펙 04 변경)
      router.push(`/editor/${template.id}/done`);
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

      <p className="text-muted pt-3 pb-3.5 text-center text-[11px]">
        Tap a slot to add a photo
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
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
