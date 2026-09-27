import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function navigate(page: Page, name: string | RegExp) {
  const menu = page.getByRole("button", {
    name: "Toggle navigation",
    exact: true,
  });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name })
    .click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".library-status")).toContainText("Library ready");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("real retrieval, original source, and a persistent bookmark", async ({
  page,
}, testInfo) => {
  await page.screenshot({
    path: testInfo.outputPath("home.png"),
    fullPage: true,
  });
  await navigate(page, "Ask the rules");
  await page
    .getByRole("textbox", { name: "Your rules question" })
    .fill("Does becoming incapacitated end my concentration on a spell?");
  await page
    .getByRole("button", { name: "Find a ruling", exact: true })
    .click();
  const citation = page.getByRole("button", {
    name: /Open source \d+: Concentration/,
  });
  await expect(citation).toBeVisible({ timeout: 90_000 });
  await citation.click();
  await expect(page.getByRole("dialog")).toContainText(
    "Your Concentration ends if you have the Incapacitated condition or you die.",
  );
  await expect(
    page.getByRole("link", { name: "Open original page" }),
  ).toHaveAttribute("href", /source\.pdf#page=179$/);
  await page.getByRole("button", { name: "Save passage", exact: true }).click();
  await page.getByRole("button", { name: "Close source", exact: true }).click();
  await navigate(page, /Saved passages/);
  await expect(
    page.getByRole("heading", { name: "Concentration", exact: true }),
  ).toBeVisible();
  await page.reload();
  await navigate(page, /Saved passages/);
  await expect(
    page.getByRole("heading", { name: "Concentration", exact: true }),
  ).toBeVisible();
});

test("compendium filters and original-page lookup", async ({ page }) => {
  await navigate(page, "Compendium");
  await page
    .getByRole("textbox", { name: "Find a rule by name" })
    .fill("Misty Step");
  await page
    .getByRole("combobox", { name: "Filter compendium category" })
    .selectOption("Spells");
  await page.getByRole("heading", { name: "Misty Step", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("30 feet");
  await page.getByRole("button", { name: "Close source", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Find a rule by name" })
    .fill("not-a-real-rule-xyz");
  await expect(
    page.getByRole("heading", { name: "No matching rule titles." }),
  ).toBeVisible();
});

test("another edition receives an evidence-gap response", async ({ page }) => {
  await navigate(page, "Ask the rules");
  await page
    .getByRole("textbox", { name: "Your rules question" })
    .fill("What does the 2014 grappling rule say?");
  await page
    .getByRole("button", { name: "Find a ruling", exact: true })
    .click();
  await expect(page.locator(".answer-status")).toContainText(
    "Insufficient evidence",
  );
  await expect(page.locator(".rich-text")).toContainText("SRD 5.2.1 only");
});
