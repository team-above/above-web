import { expect, test } from "@playwright/test";

test("홈에 템플릿 카드 6장이 order 순으로 보인다", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator("main ul li a");
  await expect(cards).toHaveCount(6);
  const names = [
    "Duo",
    "Punching",
    "Accent",
    "Weekly Dump",
    "Doodle",
    "Caption",
  ];
  for (const [i, name] of names.entries()) {
    await expect(cards.nth(i)).toContainText(name);
  }
  await expect(page.getByText("6 frames")).toBeVisible();
});

test("카드를 탭하면 해당 에디터로 이동한다", async ({ page }) => {
  await page.goto("/");
  await page.locator("main ul li a").first().click();
  await expect(page).toHaveURL(/\/editor\/duo$/);
  await expect(page.getByRole("heading", { name: "Duo" })).toBeVisible();
});

test("존재하지 않는 frameId는 404를 반환한다", async ({ page }) => {
  const response = await page.goto("/editor/unknown");
  expect(response?.status()).toBe(404);
});
