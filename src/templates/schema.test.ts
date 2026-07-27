import { describe, expect, it } from "vitest";
import { TemplateValidationError, validateTemplate } from "./schema";

function validTemplate() {
  const variant = {
    canvas: { width: 1080, height: 1350 },
    assets: {
      base: "/frames/frame01/post/base.png",
      overlay: "/frames/frame01/post/overlay.png",
    },
    slots: [{ id: "main", label: "사진" }],
    placements: [
      {
        slot: "main",
        rect: { x: 10, y: 20, width: 300, height: 400 },
        mask: "/frames/frame01/post/mask-main.png",
        fit: "cover",
      },
    ],
  };
  return {
    id: "frame01",
    name: "Duo",
    order: 1,
    preview: "/frames/frame01/preview.png",
    variants: { post: variant, story: structuredClone(variant) },
  };
}

describe("validateTemplate", () => {
  it("올바른 템플릿을 통과시킨다", () => {
    const t = validateTemplate(validTemplate());
    expect(t.id).toBe("frame01");
    expect(t.variants.post.slots).toHaveLength(1);
  });

  it("존재하지 않는 슬롯을 참조하는 placement를 거부한다", () => {
    const t = validTemplate();
    t.variants.post.placements[0].slot = "ghost";
    expect(() => validateTemplate(t)).toThrow(TemplateValidationError);
    expect(() => validateTemplate(t)).toThrow(/존재하지 않는 슬롯/);
  });

  it("placement 없는 슬롯을 거부한다", () => {
    const t = validTemplate();
    t.variants.post.slots.push({ id: "extra", label: "추가" });
    expect(() => validateTemplate(t)).toThrow(/placement 없음/);
  });

  it("슬롯 id 중복을 거부한다", () => {
    const t = validTemplate();
    t.variants.post.slots.push({ id: "main", label: "중복" });
    expect(() => validateTemplate(t)).toThrow(/중복/);
  });

  it("post/story 중 하나라도 없으면 거부한다", () => {
    const t = validTemplate() as unknown as Record<string, unknown>;
    delete (t.variants as Record<string, unknown>).story;
    expect(() => validateTemplate(t)).toThrow(TemplateValidationError);
  });

  it("canvas 형식 오류를 거부한다", () => {
    const t = validTemplate();
    // @ts-expect-error 검증 대상 오류 케이스
    t.variants.post.canvas = { width: "1080", height: 1350 };
    expect(() => validateTemplate(t)).toThrow(/canvas/);
  });

  it("placements가 비어 있으면 거부한다", () => {
    const t = validTemplate();
    t.variants.post.placements = [];
    expect(() => validateTemplate(t)).toThrow(/placements/);
  });

  it("rect 필드 누락을 거부한다", () => {
    const t = validTemplate();
    // @ts-expect-error 검증 대상 오류 케이스
    t.variants.post.placements[0].rect = { x: 1, y: 2, width: 3 };
    expect(() => validateTemplate(t)).toThrow(/rect/);
  });

  it("cover 외의 fit을 거부한다", () => {
    const t = validTemplate();
    t.variants.post.placements[0].fit = "contain";
    expect(() => validateTemplate(t)).toThrow(/fit/);
  });

  it("슬롯 항목 형식 오류를 거부한다", () => {
    const t = validTemplate();
    // @ts-expect-error 검증 대상 오류 케이스
    t.variants.post.slots.push({ id: 3, label: "숫자 id" });
    expect(() => validateTemplate(t)).toThrow(/slots 항목/);
  });

  it("name/order 누락을 거부한다", () => {
    const noName = validTemplate() as unknown as Record<string, unknown>;
    delete noName.name;
    expect(() => validateTemplate(noName)).toThrow(/name/);
    const noOrder = validTemplate() as unknown as Record<string, unknown>;
    delete noOrder.order;
    expect(() => validateTemplate(noOrder)).toThrow(/order/);
  });

  it("실제 파생 템플릿 JSON 6개가 전부 검증을 통과한다", async () => {
    const templates = await Promise.all([
      import("./frame01.json"),
      import("./frame02.json"),
      import("./frame03.json"),
      import("./frame04.json"),
      import("./frame05.json"),
      import("./frame06.json"),
    ]);
    templates.forEach((mod, i) => {
      const t = validateTemplate(mod.default);
      expect(t.id).toBe(`frame0${i + 1}`);
    });
  });

  it("assets 경로가 없으면 거부한다", () => {
    const t = validTemplate();
    // @ts-expect-error 검증 대상 오류 케이스
    delete t.variants.post.assets.overlay;
    expect(() => validateTemplate(t)).toThrow(/assets/);
  });
});
