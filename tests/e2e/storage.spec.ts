import { Buffer } from "node:buffer";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

test.describe("Storage page (authenticated)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await page.waitForURL(/\/(chats|tasks)/);
  });

  test.afterEach(() => {
    rmSync("local/uploads", { recursive: true, force: true });
  });

  async function createFolder(page: import("@playwright/test").Page) {
    const folderName = `e2e-folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await page.getByRole("button", { name: /new folder/i }).click();
    await page.getByLabel("Folder Name").fill(folderName);
    await page.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByRole("cell", { name: folderName, exact: true })).toBeVisible();
    return folderName;
  }

  test("folder lifecycle: create, open, navigate back, delete", async ({ page }) => {
    await page.goto("/storage");
    const folderName = await createFolder(page);

    await page.getByRole("cell", { name: folderName, exact: true }).getByRole("button").click();
    await expect(page.getByRole("cell", { name: ".keep", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Go to root folder" }).click();
    await expect(page.getByRole("cell", { name: folderName, exact: true })).toBeVisible();

    const row = page.getByRole("row").filter({
      has: page.locator("td", { hasText: folderName }),
    });
    await row.getByRole("button").last().click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("cell", { name: folderName, exact: true })).not.toBeVisible();

    expect(existsSync(path.resolve("local/uploads", folderName))).toBe(false);
  });

  test("upload a file, then delete it", async ({ page }) => {
    await page.goto("/storage");
    const fileName = `e2e-upload-${Date.now()}.txt`;

    await page
      .locator('#root input[type="file"]')
      .setInputFiles({ name: fileName, mimeType: "text/plain", buffer: Buffer.from("hello e2e") });
    const row = page.getByRole("row").filter({
      has: page.locator("td", { hasText: fileName }),
    });
    await expect(row).toBeVisible();

    await row.getByRole("button").last().click();
    await expect(row).not.toBeVisible();
  });
});
