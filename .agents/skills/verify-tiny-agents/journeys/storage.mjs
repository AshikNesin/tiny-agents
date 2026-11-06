// Feature: storage (features/storage.md). Folder, multi-upload, byte-exact download, view,
// rename, single and bulk delete, reload persistence, folder delete.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { journey, expect } from "../scripts/lib.mjs";

const evidence = (file) => path.join(process.env.TA_VERIFY_EVIDENCE, "storage", file);

await journey("storage", async ({ page, step, proof, cleanup, api, stamp }) => {
  const folder = `verify-folder-${stamp}`;
  const textName = `hello-${stamp}.txt`;
  const binName = `bytes-${stamp}.bin`;
  const renamed = `renamed-${stamp}.txt`;
  const text = `hello from verify ${stamp}\nsecond line ✓\n`;
  // Every byte value, so an encoding or truncation bug cannot hide.
  const bytes = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256));
  const row = (name) =>
    page.getByRole("row").filter({ has: page.getByRole("cell", { name, exact: true }) });
  const listFolder = () => api.get(`/storage/files?folder=${encodeURIComponent(`${folder}/`)}`);
  // A product bug fails the drive at the end but lets the rest of the recipe run.
  const bugs = [];
  const bugStep = async (name, body) => {
    try {
      await step(name, body);
    } catch {
      bugs.push(name);
    }
  };

  await step("open /storage", async () => {
    await page.goto("/storage");
    await expect(page.getByRole("heading", { name: "Storage", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();
  });
  await step("create a folder through New Folder", async () => {
    await page.getByRole("button", { name: /new folder/i }).click();
    const dialog = page.getByRole("dialog", { name: "Create New Folder" });
    await dialog.getByLabel("Folder Name").fill(folder);
    await dialog.getByRole("button", { name: /^create$/i }).click();
    cleanup(async () => {
      const root = await api.get("/storage/files");
      if (root.some((f) => f.name === folder))
        await api.delete(`/storage/folders/${encodeURIComponent(`${folder}/`)}`);
    });
    await expect(page.getByRole("cell", { name: folder, exact: true })).toBeVisible();
  });
  await step("open the folder: breadcrumb and URL follow it", async () => {
    await page.getByRole("cell", { name: folder, exact: true }).getByRole("button").click();
    await expect(page).toHaveURL(new RegExp(`[?&]path=${folder}`));
    await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText(folder);
  });
  await step("upload two files at once through the Upload button's file chooser", async () => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload" }).click();
    await (
      await chooser
    ).setFiles([
      { name: textName, mimeType: "text/plain", buffer: Buffer.from(text) },
      { name: binName, mimeType: "application/octet-stream", buffer: bytes },
    ]);
    await expect(page.getByText("2 uploaded", { exact: true })).toBeVisible();
    await expect(row(textName)).toBeVisible();
    await expect(row(binName)).toBeVisible();
    await expect(row(binName)).toContainText("512");
  });
  await proof("uploaded");
  await step("download returns the exact bytes", async () => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: `Download ${binName}` }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(binName);
    const got = await readFile(await file.path());
    expect(Buffer.compare(got, bytes), "downloaded bytes equal uploaded bytes").toBe(0);
    await expect(page.getByText("File downloaded successfully")).toBeVisible();
    // Second view: the API serves the same bytes.
    const res = await page.request.get(
      `/api/v1/storage/files/download?filePath=${encodeURIComponent(`${folder}/${binName}`)}`,
    );
    expect(res.status()).toBe(200);
    expect(Buffer.compare(await res.body(), bytes)).toBe(0);
  });
  await step("View opens the text file in a new tab", async () => {
    const popup = page.context().waitForEvent("page");
    await row(textName).getByRole("button", { name: "View" }).click();
    const tab = await popup;
    await expect(tab.locator("body")).toContainText(`hello from verify ${stamp}`);
    await tab.screenshot({ path: evidence("view-tab.png") });
    // Regression check for #168: text used to open as windows-1252 ("✓" as "âœ“")
    // because the blob URL dropped the charset.
    await bugStep("View decodes UTF-8 text correctly", async () => {
      await expect(tab.locator("body")).toContainText("second line ✓", { timeout: 2000 });
    });
    await tab.close();
  });
  await step("rename the text file", async () => {
    await page.getByRole("button", { name: `Rename ${textName}` }).click();
    const dialog = page.getByRole("dialog", { name: "Rename File" });
    await expect(dialog.getByLabel("New Name")).toHaveValue(textName);
    await dialog.getByLabel("New Name").fill(renamed);
    await dialog.getByRole("button", { name: "Rename" }).click();
    await expect(row(renamed)).toBeVisible();
    await expect(row(textName)).toHaveCount(0);
    const names = (await listFolder()).map((f) => f.name);
    expect(names).toContain(renamed);
    expect(names).not.toContain(textName);
  });
  await step("reload: folder, files and renamed name come back", async () => {
    await page.reload();
    await expect(row(renamed)).toBeVisible();
    await expect(row(binName)).toBeVisible();
  });
  await proof("renamed-after-reload");
  await step("delete one file from its row (no confirm)", async () => {
    await page.getByRole("button", { name: `Delete ${renamed}` }).click();
    await expect(row(renamed)).toHaveCount(0);
    await expect.poll(async () => (await listFolder()).map((f) => f.name)).not.toContain(renamed);
  });
  await step(
    "Select All Files selects every file (the folder's .keep marker too); Clear resets",
    async () => {
      await page.getByRole("button", { name: "Select All Files" }).click();
      await expect(page.getByRole("button", { name: "Clear (2)" })).toBeVisible();
      await page.getByRole("button", { name: "Clear (2)" }).click();
      await expect(page.getByRole("button", { name: /^Clear \(/ })).toHaveCount(0);
    },
  );
  await step(
    "select one file by its checkbox, bulk Delete asks to confirm, then removes it",
    async () => {
      await row(binName).getByRole("checkbox").click();
      await expect(page.getByRole("button", { name: "Clear (1)" })).toBeVisible();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toContainText("Delete 1 file?");
      await confirm.getByRole("button", { name: "Delete" }).click();
      await expect(row(binName)).toHaveCount(0);
      // The row leaves the UI before the DELETE resolves: poll the server.
      await expect
        .poll(
          async () => (await listFolder()).filter((f) => !f.isDirectory && f.name !== ".keep"),
          { timeout: 15_000 },
        )
        .toEqual([]);
    },
  );
  await step("back to root via the breadcrumb, delete the folder after confirming", async () => {
    await page.getByRole("button", { name: "Go to root folder" }).click();
    await page.getByRole("button", { name: `Delete folder ${folder}` }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(`Delete folder "${folder}/"?`);
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("cell", { name: folder, exact: true })).toHaveCount(0);
    // The row leaves the UI first; poll the server rather than read it once.
    await expect
      .poll(async () => (await api.get("/storage/files")).map((f) => f.name), { timeout: 15_000 })
      .not.toContain(folder);
  });
  await proof("folder-deleted");
  if (bugs.length) throw new Error(`product bug(s): ${bugs.join("; ")}`);
});
