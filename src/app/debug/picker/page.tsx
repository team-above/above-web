"use client";

/**
 * iOS 파일 메뉴 프리뷰 판(블롭) 진단용 임시 페이지 — 실기기에서 4가지 트리거 방식을
 * 비교해 판이 없는 방식을 찾는다. 확인 후 삭제 예정. (스펙 06 변경 이력 참조)
 */
import { useRef, useState } from "react";

const BUTTON_CLASS =
  "bg-ink block w-full rounded-xl px-4 py-3 text-center text-[15px] font-semibold text-white";

export default function PickerDebugPage() {
  const aRef = useRef<HTMLInputElement>(null);
  const bRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const onPick =
    (label: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setPicked(`${label}: ${e.target.files?.[0]?.name ?? "(없음)"}`);
      e.target.value = "";
    };

  return (
    <main className="mx-auto flex max-w-105 flex-col gap-5 px-5 py-10">
      <h1 className="text-ink text-lg font-bold">파일 메뉴 프리뷰 판 진단</h1>
      <p className="text-muted text-[13px]">
        각 버튼을 눌러 메뉴 뒤에 블롭(반투명 판)이 뜨는지 확인해 주세요.
        방식별로 뜨는지/안 뜨는지만 알려주시면 됩니다.
      </p>

      {/* A. display:none + 프로그램 click() — 원래 방식 */}
      <div>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => aRef.current?.click()}
        >
          A. hidden input + click()
        </button>
        <input
          ref={aRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPick("A")}
        />
      </div>

      {/* B. 화면 밖(-9999px) input + 프로그램 click() */}
      <div>
        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={() => bRef.current?.click()}
        >
          B. 화면 밖 input + click()
        </button>
        <input
          ref={bRef}
          type="file"
          accept="image/*"
          className="fixed top-0 left-[-9999px] h-px w-px"
          tabIndex={-1}
          onChange={onPick("B")}
        />
      </div>

      {/* C. label 네이티브 활성화 — 프로그램 click() 없음 */}
      <div>
        <label htmlFor="picker-c" className={BUTTON_CLASS}>
          C. label 네이티브 활성화
        </label>
        <input
          id="picker-c"
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={onPick("C")}
        />
      </div>

      {/* D. 투명 input이 버튼을 덮어 직접 탭 받음 */}
      <div className="relative">
        <span className={BUTTON_CLASS}>D. input 직접 탭 (투명 오버레이)</span>
        <input
          type="file"
          accept="image/*"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={onPick("D")}
        />
      </div>

      {picked && (
        <p className="text-ink rounded-lg bg-white px-4 py-3 text-[13px]">
          선택됨 — {picked}
        </p>
      )}
    </main>
  );
}
