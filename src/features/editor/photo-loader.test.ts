import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPhoto, PhotoLoadError } from "./photo-loader";

function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPhoto", () => {
  it("이미지가 아닌 파일을 거부한다", async () => {
    const file = new File(["x"], "doc.txt", { type: "text/plain" });
    await expect(loadPhoto(file)).rejects.toThrow(PhotoLoadError);
    await expect(loadPhoto(file)).rejects.toThrow(/이미지 파일만/);
  });

  it("디코딩 실패를 PhotoLoadError로 변환한다", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("깨진 파일")),
    );
    const file = new File(["x"], "broken.jpg", { type: "image/jpeg" });
    await expect(loadPhoto(file)).rejects.toThrow(/읽지 못했어요/);
  });

  it("상한 이하 사진은 원본 비트맵 그대로 반환한다 (EXIF 보정 옵션 포함)", async () => {
    const decoded = fakeBitmap(1600, 1200);
    const spy = vi.fn().mockResolvedValue(decoded);
    vi.stubGlobal("createImageBitmap", spy);
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    const result = await loadPhoto(file);
    // 확대 시 재디코딩할 수 있게 원본 파일·크기를 함께 들고 있는다
    expect(result).toEqual({
      bitmap: decoded,
      fileName: "photo.jpg",
      file,
      sourceSize: { width: 1600, height: 1200 },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
  });

  it("대형 사진은 최장변 2160으로 다운샘플하고 원본 비트맵을 닫는다", async () => {
    const decoded = fakeBitmap(8640, 4320);
    const resized = fakeBitmap(2160, 1080);
    const spy = vi
      .fn()
      .mockResolvedValueOnce(decoded)
      .mockResolvedValueOnce(resized);
    vi.stubGlobal("createImageBitmap", spy);
    const file = new File(["x"], "big.jpg", { type: "image/jpeg" });
    const result = await loadPhoto(file);
    expect(result.bitmap).toBe(resized);
    expect(spy).toHaveBeenNthCalledWith(2, decoded, {
      resizeWidth: 2160,
      resizeHeight: 1080,
      resizeQuality: "high",
    });
    expect(decoded.close).toHaveBeenCalled();
  });
});
