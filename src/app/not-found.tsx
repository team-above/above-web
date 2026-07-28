import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-135 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <Image
        src="/logo-black.png"
        alt="above."
        width={2888}
        height={776}
        className="h-7 w-auto"
      />
      <p className="text-sm text-neutral-500">페이지를 찾을 수 없어요</p>
      <Link
        href="/"
        className="mt-2 rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white"
      >
        프레임 보러 가기
      </Link>
    </main>
  );
}
