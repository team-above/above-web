import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // 라우트(src/app)와 캔버스·브라우저 API 의존 컴포넌트는 Playwright E2E·시각 회귀로 검증한다
      // — 단위 커버리지 대상은 순수 로직(lib/stores/templates/features의 비캔버스 코드)
      exclude: [
        "src/test/**",
        "src/**/*.test.{ts,tsx}",
        "src/app/**",
        "src/features/editor/EditorCanvas.tsx",
        "src/features/editor/EditorShell.tsx",
        "src/features/editor/DonePanel.tsx",
        "src/features/editor/use-image.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        // 에디터 코어 순수 로직은 100% 강제 (스펙 03 수용 기준 7)
        "src/features/editor/transform.ts": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
