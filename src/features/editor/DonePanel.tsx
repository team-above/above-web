"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useEditorStore } from "@/stores/editor";
import { canExport } from "./export";
import type { FrameTemplate } from "@/templates/schema";

/** 다운로드 완료 화면 — 이 라우트의 페이지뷰가 전환율 지표다 (스펙 04) */
export function DonePanel({ template }: { template: FrameTemplate }) {
  const router = useRouter();
  const templateId = useEditorStore((s) => s.templateId);
  const exportable = useEditorStore((s) => canExport(s.photos));
  const exportUrl = useEditorStore((s) => s.exportUrl);

  // 다운로드를 거치지 않은 접근(직접 URL·새로고침 포함) → 에디터로 돌려보내 집계 오염 방지
  const valid = templateId === template.id && exportable && Boolean(exportUrl);
  useEffect(() => {
    if (!valid) router.replace(`/editor/${template.id}`);
  }, [valid, router, template.id]);
  if (!valid) return null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-2xl font-bold">저장했어요</h1>
      {/* blob objectURL은 next/image 최적화 대상이 아니므로 img 사용 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={exportUrl!}
        alt={`${template.name} 내보내기 결과 미리보기`}
        className="max-h-[50dvh] w-auto rounded-2xl"
      />
      <p className="text-sm text-neutral-400">
        사진이 저장되지 않았다면 미리보기를 길게 눌러 저장하세요
      </p>
      <div className="mt-2 flex gap-3">
        <Link
          href={`/editor/${template.id}`}
          className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white"
        >
          계속 편집
        </Link>
        <Link
          href="/"
          className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold"
        >
          다른 프레임 보기
        </Link>
      </div>
    </div>
  );
}
