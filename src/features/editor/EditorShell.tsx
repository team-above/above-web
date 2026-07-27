"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/stores/editor";
import type { FrameTemplate, VariantId } from "@/templates/schema";
import { loadPhoto, PhotoLoadError } from "./photo-loader";

const EditorCanvas = dynamic(() => import("./EditorCanvas"), { ssr: false });

const RATIO_LABEL: Record<VariantId, string> = {
  post: "Post 4:5",
  story: "Story 9:16",
};

export function EditorShell({ template }: { template: FrameTemplate }) {
  const variant = useEditorStore((s) => s.variant);
  const setVariant = useEditorStore((s) => s.setVariant);
  const enterTemplate = useEditorStore((s) => s.enterTemplate);
  const setPhoto = useEditorStore((s) => s.setPhoto);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    enterTemplate(template.id);
  }, [enterTemplate, template.id]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error]);

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
    } catch (cause) {
      setError(
        cause instanceof PhotoLoadError
          ? cause.message
          : "사진을 불러오지 못했어요",
      );
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-center pb-4">
        <div className="flex rounded-full bg-neutral-200/70 p-1">
          {(Object.keys(RATIO_LABEL) as VariantId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setVariant(id)}
              className={
                variant === id
                  ? "rounded-full bg-white px-4 py-1.5 text-sm font-semibold shadow-sm"
                  : "rounded-full px-4 py-1.5 text-sm text-neutral-500"
              }
            >
              {RATIO_LABEL[id]}
            </button>
          ))}
        </div>
      </div>

      <EditorCanvas template={template} onSlotTap={handleSlotTap} />

      <p className="py-4 text-center text-sm text-neutral-400">
        슬롯을 탭해서 사진을 넣어 보세요
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

      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-neutral-900/90 px-4 py-2 text-sm text-white">
          {error}
        </div>
      )}
    </div>
  );
}
