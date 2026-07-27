import Link from "next/link";
import { notFound } from "next/navigation";
import { EditorShell } from "@/features/editor/EditorShell";
import { getTemplate, templates } from "@/templates";

export function generateStaticParams() {
  return templates.map((template) => ({ frameId: template.id }));
}

export default async function EditorPage({
  params,
}: {
  params: Promise<{ frameId: string }>;
}) {
  const { frameId } = await params;
  const template = getTemplate(frameId);
  if (!template) notFound();

  return (
    <main className="mx-auto flex h-dvh w-full max-w-135 flex-col px-4 pt-4">
      <header className="flex items-center justify-between pb-4">
        <Link href="/" className="text-sm font-medium">
          ‹ Home
        </Link>
        <h1 className="font-bold">{template.name}</h1>
        {/* 다운로드는 스펙 04 — 자리만 잡아둔다 */}
        <button
          type="button"
          disabled
          aria-label="다운로드 (준비 중)"
          className="text-sm text-neutral-300"
        >
          ↓
        </button>
      </header>
      <EditorShell template={template} />
    </main>
  );
}
