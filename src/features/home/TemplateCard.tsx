import Image from "next/image";
import Link from "next/link";
import type { FrameTemplate } from "@/templates/schema";

interface TemplateCardProps {
  template: FrameTemplate;
  /** 첫 화면에 보이는 카드만 true — LCP 이미지 우선 로드 */
  priority?: boolean;
}

/** 참고 시안의 "카드 덱" — 메인 카드 아래로 흰 시트 2장이 살짝 삐져나온다 */
export function TemplateCard({
  template,
  priority = false,
}: TemplateCardProps) {
  return (
    <Link href={`/editor/${template.id}`} className="block">
      <div className="relative pb-1.5">
        {/* 뒤 시트 2장 (아래로 6px 노출) */}
        <div className="absolute inset-x-5 top-1.5 bottom-0 rounded-[28px] bg-white opacity-55 shadow-[0_2px_10px_rgba(0,0,0,0.07)]" />
        <div className="absolute inset-x-2.5 top-[3px] bottom-0 rounded-[26px] bg-white opacity-78 shadow-[0_2px_10px_rgba(0,0,0,0.07)]" />
        {/* 메인 카드 */}
        <div className="relative overflow-hidden rounded-3xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.1)]">
          <div className="relative overflow-hidden">
            <Image
              src={template.preview}
              alt={template.name}
              width={540}
              height={675}
              priority={priority}
              className="aspect-4/5 w-full object-cover"
            />
            {/* 미리보기 하단이 흰 바와 만나는 지점의 은은한 그라디언트 */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-b from-transparent to-black/8" />
          </div>
          <div className="flex items-center justify-between px-4 pt-3 pb-3.5">
            <span className="text-ink text-[15px] font-semibold">
              {template.name}
            </span>
            <div className="flex gap-1.5">
              <span className="bg-surface text-muted rounded-full px-2 py-[3px] text-[11px] font-medium">
                Post
              </span>
              <span className="bg-surface text-muted rounded-full px-2 py-[3px] text-[11px] font-medium">
                Story
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
