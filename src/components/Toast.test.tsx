import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Toast", () => {
  it("성공 톤: 메시지와 체크 아이콘을 보여준다", () => {
    render(<Toast message="저장했어요" tone="success" />);
    expect(screen.getByRole("status")).toHaveTextContent("저장했어요");
    expect(screen.getByTestId("toast-icon-success")).toBeInTheDocument();
  });

  it("에러 톤: 브랜드 오렌지 느낌표 아이콘을 쓴다", () => {
    render(<Toast message="사진을 불러오지 못했어요" tone="error" />);
    expect(screen.getByTestId("toast-icon-error")).toBeInTheDocument();
  });

  it("message가 null이 되면 퇴장 애니메이션 후 사라진다", () => {
    const { rerender } = render(<Toast message="저장했어요" />);
    rerender(<Toast message={null} />);
    // 퇴장 중에는 아직 보인다
    expect(screen.getByRole("status")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("처음부터 null이면 아무것도 렌더하지 않는다", () => {
    render(<Toast message={null} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
