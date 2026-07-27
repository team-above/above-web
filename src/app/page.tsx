import Image from "next/image";
import { TemplateCard } from "@/features/home/TemplateCard";
import { templates } from "@/templates";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-135 flex-1 flex-col px-5 pt-5 pb-12">
      <header className="pb-5">
        <h1>
          <Image
            src="/logo-black.png"
            alt="above."
            width={2888}
            height={776}
            priority
            className="h-8 w-auto"
          />
        </h1>
      </header>
      <div className="flex items-baseline justify-between pb-3">
        <h2 className="text-lg font-bold">Frame templates</h2>
        <span className="text-sm text-neutral-500">
          {templates.length} frames
        </span>
      </div>
      <ul className="flex flex-col gap-5">
        {templates.map((template, index) => (
          <li key={template.id}>
            <TemplateCard template={template} priority={index === 0} />
          </li>
        ))}
      </ul>
    </main>
  );
}
