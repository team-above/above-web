import Link from "next/link";
import { notFound } from "next/navigation";
import { getTemplate, templates } from "@/templates";

export function generateStaticParams() {
  return templates.map((template) => ({ frameId: template.id }));
}

// 에디터 본 구현은 스펙 03에서 — 지금은 라우팅 구조(템플릿별 페이지뷰 집계 포함)만 잡는다
export default async function EditorPage({
  params,
}: {
  params: Promise<{ frameId: string }>;
}) {
  const { frameId } = await params;
  const template = getTemplate(frameId);
  if (!template) notFound();

  return (
    <main className="mx-auto flex w-full max-w-135 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <h1 className="text-2xl font-bold">{template.name}</h1>
      <p className="text-sm text-neutral-500">에디터를 준비하고 있어요</p>
      <Link href="/" className="mt-4 text-sm font-medium underline">
        템플릿 목록으로 돌아가기
      </Link>
    </main>
  );
}
