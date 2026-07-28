import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 로컬 1회 재시도: dev 서버 최초 컴파일 중 병렬 실행 타이밍 플레이크 흡수
  retries: process.env.CI ? 2 : 1,
  use: {
    // E2E 전용 포트 — 다른 프로젝트 dev 서버(3000)와의 충돌 원천 차단
    baseURL: "http://localhost:3897",
    trace: "on-first-retry",
  },
  projects: [
    // 모바일 웹이 주 타깃 — 모바일 뷰포트를 기본으로 둔다
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev -- -p 3897",
    url: "http://localhost:3897",
    reuseExistingServer: !process.env.CI,
  },
});
