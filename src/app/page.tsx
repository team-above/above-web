import Image from "next/image";
import { ResetEditor } from "@/features/home/ResetEditor";
import { Reveal } from "@/features/home/Reveal";
import { TemplateCard } from "@/features/home/TemplateCard";
import { templates } from "@/templates";

export default function Home() {
  return (
    <main className="flex w-full flex-1 flex-col pb-20">
      <ResetEditor />
      <header className="px-5 pt-5 pb-4">
        <h1>
          <Image
            src="/logo-black.png"
            alt="above."
            width={2888}
            height={776}
            priority
            className="h-8.5 w-auto"
          />
        </h1>
      </header>
      <div className="flex items-center justify-between px-5 pb-3">
        <h2 className="text-ink text-[17px] font-semibold">Frame templates</h2>
        <span className="text-[13px] font-medium text-black">
          {templates.length} frames
        </span>
      </div>
      <ul className="flex flex-col gap-5 px-4">
        {templates.map((template, index) => (
          <Reveal key={template.id} index={index}>
            <TemplateCard template={template} priority={index === 0} />
          </Reveal>
        ))}
      </ul>
    </main>
  );
}
