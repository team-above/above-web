import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getTemplate } from "@/templates";
import { TemplateCard } from "./TemplateCard";

const template = getTemplate("duo")!;

describe("TemplateCard", () => {
  it("에디터 링크·미리보기·이름·비율 배지를 렌더한다", () => {
    render(<TemplateCard template={template} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/editor/duo");
    expect(screen.getByRole("img", { name: "Duo" })).toBeInTheDocument();
    expect(screen.getByText("Duo")).toBeInTheDocument();
    expect(screen.getByText("Post")).toBeInTheDocument();
    expect(screen.getByText("Story")).toBeInTheDocument();
  });
});
