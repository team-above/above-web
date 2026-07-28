import { notFound } from "next/navigation";
import { DoneBeacon } from "@/features/editor/DoneBeacon";
import { getTemplate, templates } from "@/templates";

export function generateStaticParams() {
  return templates.map((template) => ({ frameId: template.id }));
}

// 다운로드 집계 전용 — 화면 없이 페이지뷰만 남기고 에디터로 복귀한다
export default async function DonePage({
  params,
}: {
  params: Promise<{ frameId: string }>;
}) {
  const { frameId } = await params;
  if (!getTemplate(frameId)) notFound();
  return <DoneBeacon frameId={frameId} />;
}
