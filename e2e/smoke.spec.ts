import { expect, test } from "@playwright/test";

test("홈 페이지가 렌더링된다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "above." })).toBeVisible();
});
