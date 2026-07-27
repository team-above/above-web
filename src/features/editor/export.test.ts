import { describe, expect, it } from "vitest";
import type { SlotPhoto } from "@/stores/editor";
import { canExport, exportFileName } from "./export";

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
