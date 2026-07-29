import { describe, expect, it } from "vitest";
import type { SlotPhoto } from "@/stores/editor";
import {
  canExport,
  dataUrlToBlob,
  exportFileName,
  shouldUseShareSheet,
} from "./export";

describe("exportFileName", () => {
  it("above-{frameId}-{variant}.png 형식이다", () => {
    expect(exportFileName("frame01", "post")).toBe("above-frame01-post.png");
    expect(exportFileName("frame06", "story")).toBe("above-frame06-story.png");
  });
});

describe("canExport", () => {
  const photo = { bitmap: {} as ImageBitmap, fileName: "a.jpg" } as SlotPhoto;

  it("사진 1장 이상일 때만 true", () => {
    expect(canExport({})).toBe(false);
    expect(canExport({ left: photo })).toBe(true);
    expect(canExport({ left: photo, right: photo })).toBe(true);
  });
});

describe("shouldUseShareSheet", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15";
  const IPAD_AS_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126";

  it("iOS(iPhone)에서 파일 공유 가능하면 공유 시트", () => {
    expect(shouldUseShareSheet(IPHONE, 5, true)).toBe(true);
  });

  it("iPadOS는 Mac UA + 멀티터치로 판별한다", () => {
    expect(shouldUseShareSheet(IPAD_AS_MAC, 5, true)).toBe(true);
    expect(shouldUseShareSheet(IPAD_AS_MAC, 0, true)).toBe(false); // 진짜 macOS
  });

  it("Android·데스크톱은 앵커 다운로드(즉시 저장) — 공유 시트 아님", () => {
    expect(shouldUseShareSheet(ANDROID, 5, true)).toBe(false);
  });

  it("공유 불가 환경(인앱 등)이면 iOS라도 앵커 폴백", () => {
    expect(shouldUseShareSheet(IPHONE, 5, false)).toBe(false);
  });
});

describe("dataUrlToBlob", () => {
  it("data URL을 원본 바이트·MIME 그대로 Blob으로 변환한다", async () => {
    // "PNG!" (0x50 0x4E 0x47 0x21) — base64 UE5HIQ==
    const blob = dataUrlToBlob("data:image/png;base64,UE5HIQ==");
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([0x50, 0x4e, 0x47, 0x21]),
    );
  });
});
