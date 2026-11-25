// Feature: code (features/code.md). Open a thread's worktree in Cursor or Zed over SSH
// (`ta-verify up --demo-agent --fake-github --local-sandbox`): the header button and `o`,
// the SSH config the sandbox needs, the link, and the remembered editor and host.
import { journey, expect } from "../scripts/lib.mjs";

const LOADED = { waitUntil: "domcontentloaded" };

await journey("code-open-editor", async ({ page, step, proof, cleanup, api, stamp }) => {
  let project;
  let id;
  const dialog = page.getByTestId("code-open-editor");
  const host = dialog.getByLabel("SSH host");

  await step("setup: a project thread on the demo agent", async () => {
    project = await api.post("/code/projects", {
      repo: "acme/web",
      name: `web-${stamp}`,
      defaultInstanceId: "demo",
    });
    cleanup(() => api.delete(`/code/projects/${project.id}`));
    id = (
      await api.post("/code/threads", {
        instanceId: "demo",
        projectId: project.id,
        message: `Note the release ${stamp}`,
      })
    ).threadId;
    cleanup(() => api.delete(`/code/threads/${encodeURIComponent(id)}`));
  });

  await step("the header's Open in editor button opens the dialog on Cursor", async () => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/code/t/${encodeURIComponent(id)}`, LOADED);
    await page.getByRole("button", { name: "Open in editor" }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Cursor" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(host).toHaveValue("tiny-agents-sandbox");
    await expect(dialog.getByTestId("code-editor-ssh-config")).toContainText(
      "Host tiny-agents-sandbox",
    );
  });
  await proof("sandbox-config");

  await step("Escape closes it; o opens it again", async () => {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press("o");
    await expect(dialog).toBeVisible();
  });

  await step("pick Zed and a plain host; Copy link gives Zed's SSH link", async () => {
    await dialog.getByRole("radio", { name: "Zed" }).click();
    await host.fill("tiny-agents.exe.xyz");
    await expect(dialog.getByTestId("code-editor-ssh-config")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Copy link" }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/^zed:\/\/ssh\/tiny-agents\.exe\.xyz\/.+/);
  });
  await proof("zed");

  await step("Open in Zed remembers the editor and host in a fresh tab", async () => {
    await dialog.getByRole("button", { name: "Open in Zed" }).click();
    await expect(dialog).toHaveCount(0);
    const again = await page.context().newPage();
    cleanup(() => again.close());
    await again.goto(`/code/t/${encodeURIComponent(id)}`, LOADED);
    await again.getByRole("button", { name: "Open in editor" }).click();
    const reopened = again.getByTestId("code-open-editor");
    await expect(reopened.getByRole("radio", { name: "Zed" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(reopened.getByLabel("SSH host")).toHaveValue("tiny-agents.exe.xyz");
  });
});
