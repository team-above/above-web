import { describe, expect, it } from "vitest";
import frame02 from "./frame02.json";
import frame05 from "./frame05.json";
import { getTemplate, loadTemplates, templates } from "./index";
import { TemplateValidationError } from "./schema";

describe("템플릿 로더", () => {
  it("6개 템플릿을 order 오름차순으로 제공한다", () => {
    expect(templates).toHaveLength(6);
    expect(templates.map((t) => t.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(templates[0].id).toBe("frame01");
    expect(templates[5].id).toBe("frame06");
  });

  it("모든 템플릿에 미리보기 경로가 있다", () => {
    for (const t of templates) {
      expect(t.preview).toBe(`/frames/${t.id}/preview.webp`);
    }
  });

  it("id로 템플릿을 찾고, 없으면 undefined", () => {
    expect(getTemplate("frame03")?.name).toBe("Accent");
    expect(getTemplate("nope")).toBeUndefined();
  });

  it("입력 순서와 무관하게 order로 정렬한다", () => {
    const loaded = loadTemplates([frame05, frame02]);
    expect(loaded.map((t) => t.id)).toEqual(["frame02", "frame05"]);
  });

  it("검증 실패 JSON을 만나면 throw한다", () => {
    expect(() => loadTemplates([frame02, { id: "broken" }])).toThrow(
      TemplateValidationError,
    );
  });
});
