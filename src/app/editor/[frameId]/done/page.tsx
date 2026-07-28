import { notFound } from "next/navigation";
import { DonePanel } from "@/features/editor/DonePanel";
import { getTemplate, templates } from "@/templates";

export function generateStaticParams() {
  return templates.map((template) => ({ frameId: template.id }));
}

export default async function DonePage({
  params,
}: {
  params: Promise<{ frameId: string }>;
}) {
  const { frameId } = await params;
  const template = getTemplate(frameId);
  if (!template) notFound();

  return (
    <main className="flex h-dvh w-full flex-col px-6 py-6">
      <DonePanel template={template} />
    </main>
  );
}
