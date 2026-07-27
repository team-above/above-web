import Image from "next/image";
import Link from "next/link";
import type { FrameTemplate } from "@/templates/schema";

interface TemplateCardProps {
  template: FrameTemplate;
  /** 첫 화면에 보이는 카드만 true — LCP 이미지 우선 로드 */
  priority?: boolean;
}

export function TemplateCard({
  template,
  priority = false,
}: TemplateCardProps) {
  return (
    <Link
      href={`/editor/${template.id}`}
      className="block overflow-hidden rounded-2xl bg-white"
    >
      <Image
        src={template.preview}
        alt={template.name}
        width={540}
        height={675}
        priority={priority}
        className="aspect-4/5 w-full object-cover"
      />
      <div className="flex items-center justify-between px-4 py-3.5">
        <span className="font-semibold">{template.name}</span>
        <div className="flex gap-1.5">
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-400">
            Post
          </span>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-400">
            Story
          </span>
        </div>
      </div>
    </Link>
  );
}
