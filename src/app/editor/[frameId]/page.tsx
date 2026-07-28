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
    <main className="flex h-dvh w-full flex-col">
      <EditorShell template={template} />
    </main>
  );
}
