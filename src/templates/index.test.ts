import { describe, expect, it } from "vitest";
import punching from "./punching.json";
import doodle from "./doodle.json";
import { getTemplate, loadTemplates, templates } from "./index";
import { TemplateValidationError } from "./schema";

describe("템플릿 로더", () => {
  it("7개 템플릿을 order 오름차순으로 제공한다", () => {
    expect(templates).toHaveLength(7);
    expect(templates.map((t) => t.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(templates[0].id).toBe("duo");
    expect(templates[6].id).toBe("mintdot");
  });

  it("모든 템플릿에 미리보기 경로가 있다", () => {
    for (const t of templates) {
      expect(t.preview).toBe(`/frames/${t.id}/preview.webp`);
    }
  });

  it("id로 템플릿을 찾고, 없으면 undefined", () => {
    expect(getTemplate("accent")?.name).toBe("Accent");
    expect(getTemplate("nope")).toBeUndefined();
  });

  it("입력 순서와 무관하게 order로 정렬한다", () => {
    const loaded = loadTemplates([doodle, punching]);
    expect(loaded.map((t) => t.id)).toEqual(["punching", "doodle"]);
  });

  it("검증 실패 JSON을 만나면 throw한다", () => {
    expect(() => loadTemplates([punching, { id: "broken" }])).toThrow(
      TemplateValidationError,
    );
  });
});
