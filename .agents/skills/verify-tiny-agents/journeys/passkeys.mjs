// Feature: passkeys (features/passkeys.md). Register passkeys on two Chromium virtual
// authenticators ("devices"), the same-device refusal, rename, delete, the last-passkey guard,
// then sign out and sign in with the remaining passkey.
import { journey, expect } from "../scripts/lib.mjs";

const AUTHENTICATOR = {
  protocol: "ctap2",
  transport: "internal",
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
};

await journey("passkeys", async ({ page, context, step, proof, cleanup, api, stamp }) => {
  const first = `verify-key-${stamp}-a`;
  const second = `verify-key-${stamp}-b`;
  const renamed = `verify-key-${stamp}-renamed`;
  const item = (name) =>
    page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
  const ours = async () =>
    (await api.get("/passkey/list")).filter((p) => p.credentialName?.includes(stamp));
  let cdp;
  let deviceA;

  const addPasskey = async (name) => {
    await page.getByLabel("Name (optional)").fill(name);
    await page.getByRole("button", { name: "Add passkey" }).click();
  };

  await step("setup: CDP virtual platform authenticator A (resident key, UV)", async () => {
    cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    ({ authenticatorId: deviceA } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: AUTHENTICATOR,
    }));
  });
  // The demo user's last passkey cannot be deleted (product rule); delete every other one.
  cleanup(async () => {
    for (const p of await ours()) {
      if (p.canDelete) await api.delete(`/passkey/${p.id}`);
    }
  });
  await step("open Settings → Security from the account menu", async () => {
    await page.getByRole("button", { name: "Account and navigation" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings\/account$/);
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("link", { name: "Security" })
      .click();
    await expect(page).toHaveURL(/\/settings\/security$/);
    await expect(page.getByRole("heading", { name: "Add a passkey" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your passkeys" })).toBeVisible();
  });
  await proof("security-tab");
  await step("register a named passkey on device A", async () => {
    await addPasskey(first);
    await expect(page.getByText("Passkey added successfully")).toBeVisible();
    await expect(item(first)).toBeVisible();
    await expect(item(first)).toContainText("Device-bound passkey");
    await expect(item(first)).toContainText(/Added /);
    await expect(page.getByLabel("Name (optional)")).toHaveValue("");
  });
  await step("a second passkey on the same device is refused with a toast", async () => {
    await addPasskey(`verify-key-${stamp}-dup`);
    // The browser's InvalidStateError, worded by the shell's WEBAUTHN_MESSAGES.
    await expect(
      page.getByText("This passkey is already registered to your account."),
    ).toBeVisible();
    expect((await ours()).map((p) => p.credentialName)).toEqual([first]);
  });
  await step("setup: switch to virtual authenticator B (a second device)", async () => {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: deviceA });
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTHENTICATOR });
  });
  await step("register a passkey on device B", async () => {
    await addPasskey(second);
    await expect(item(second)).toBeVisible();
    expect((await ours()).map((p) => p.credentialName).sort()).toEqual([first, second].sort());
  });
  await proof("two-passkeys");
  await step("rename the device-A passkey", async () => {
    await item(first).getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit passkey name" });
    await expect(dialog.getByLabel("Passkey name")).toHaveValue(first);
    await dialog.getByLabel("Passkey name").fill(renamed);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Passkey name updated successfully")).toBeVisible();
    await expect(item(renamed)).toBeVisible();
    await expect(item(first)).toHaveCount(0);
  });
  await step("delete the renamed passkey after confirming", async () => {
    await item(renamed).getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(renamed);
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Passkey deleted successfully")).toBeVisible();
    await expect(item(renamed)).toHaveCount(0);
    expect((await ours()).map((p) => p.credentialName)).toEqual([second]);
  });
  await step("reload: the remaining passkey persists; the last one cannot be deleted", async () => {
    await page.reload();
    await expect(item(second)).toBeVisible();
    const all = await api.get("/passkey/list");
    if (all.length === 1) {
      await expect(item(second).getByRole("button", { name: "Delete" })).toBeDisabled();
      expect(all[0].canDelete).toBe(false);
    }
  });
  await proof("last-passkey-guard");
  await step("log out from the account menu", async () => {
    // Settings is a full page with its own chrome; the account menu is in the app sidebar.
    await page.goto("/chats");
    await page.getByRole("button", { name: "Account and navigation" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
  await step("Sign in with passkey (device B) signs the demo user in", async () => {
    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    // Signed in: the app leaves /login. Where it lands after an explicit logout
    // (/settings via the route guard's "from", or / -> /chats) depends on which of
    // the logout handler and the guard redirects first, so either is accepted.
    await expect(page).toHaveURL(/\/(settings|chats)(\/[^/]+)?$/);
    const me = await page.request.get("/api/v1/auth/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).data.email).toBe("demo@example.com");
  });
  await step("the passkey now shows Last used", async () => {
    await page.goto("/settings/security");
    await expect(item(second)).toContainText(/Last used /);
    const used = (await ours()).find((p) => p.credentialName === second);
    expect(used.lastUsedAt).toBeTruthy();
  });
  await proof("signed-in-with-passkey");
});
