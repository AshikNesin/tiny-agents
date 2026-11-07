// Feature: vault (features/vault.md). Local backend (the run's SECRETS_KEY): backends card,
// step-up (wrong then right password), API key / login / card / contact by kind, values
// masked and absent from pages and API reads, reveal / copy / edit a value, policy save +
// kill switch, unlink → Not linked yet → Link, delete, the credential-request page's
// closed state, and no secret in the server log.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { journey, expect, DEMO } from "../scripts/lib.mjs";

const MASK = "••••••••••";

await journey("vault", async ({ page, context, step, proof, cleanup, api, stamp }) => {
  const keyTitle = `Verify key ${stamp}`;
  const keyHandle = `verify-key-${stamp}`;
  const loginTitle = `Verify login ${stamp}`;
  const loginHandle = `verify-login-${stamp}`;
  const cardTitle = `Verify card ${stamp}`;
  const cardHandle = `verify-card-${stamp}`;
  const contactTitle = `Verify contact ${stamp}`;
  const contactHandle = `verify-contact-${stamp}`;
  const secret = `sk-verify-${stamp}-AAAA1111`;
  const rotated = `sk-verify-${stamp}-BBBB2222`;
  const cardNumber = "4242424242424242";
  const secrets = [secret, rotated, cardNumber];
  let generated;
  let token;
  const stepUp = () => ({ "X-Vault-Step-Up": token });
  const detail = (h) => api.get(`/vault/items/${h}`);
  const purge = (h) => async () => {
    if (!token) return; // nothing was created before the first step-up
    const res = await page.request.delete(`/api/v1/vault/items/${h}?purge=true`, {
      headers: stepUp(),
    });
    if (!res.ok() && res.status() !== 404) throw new Error(`purge ${h}: ${res.status()}`);
  };
  /** Read one value back through the API (owner + step-up), never through the page. */
  const revealApi = async (h, field) => {
    const res = await page.request.post(`/api/v1/vault/items/${h}/reveal`, {
      headers: stepUp(),
      data: { field, purpose: "reveal" },
    });
    expect(res.ok(), `reveal ${res.status()}`).toBe(true);
    return (await res.json()).data.value;
  };
  const noSecretIn = (text, label) => {
    for (const value of secrets.concat(generated ? [generated] : []))
      expect(text, `${label} leaks a secret`).not.toContain(value);
  };
  // In-app navigation: a full page load drops the step-up token (page memory only).
  const toVault = async () => {
    await page.getByRole("button", { name: "Account and navigation" }).click();
    await page.getByRole("menuitem", { name: "Vault" }).click();
    await expect(page).toHaveURL(/\/vault$/);
  };
  const newItem = async (kindButton, heading) => {
    await toVault();
    await page.getByRole("button", { name: "New item" }).click();
    const picker = page.getByRole("dialog", { name: "New item" });
    await expect(picker).toContainText("Saved in Local");
    await picker.getByRole("button", { name: kindButton, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  };

  await step("open Vault from the account menu: Local ready, 1Password not set up", async () => {
    await page.getByRole("button", { name: "Account and navigation" }).click();
    await page.getByRole("menuitem", { name: "Vault" }).click();
    await expect(page).toHaveURL(/\/vault$/);
    await expect(page.getByRole("heading", { name: "Vault", exact: true })).toBeVisible();
    await expect(page.getByText("Encrypted with SECRETS_KEY")).toBeVisible();
    await expect(page.getByText("Not set up")).toBeVisible();
    await expect(page.getByRole("button", { name: "New item" })).toBeEnabled();
  });
  await proof("backends");

  await step("new API key: masked input, handle suggested from the name", async () => {
    await newItem("API key", "New api key");
    await expect(page).toHaveURL(/\/vault\/new\/api_key$/);
    await page.getByLabel("Name", { exact: true }).fill(keyTitle);
    await expect(page.getByLabel("Handle")).toHaveValue(keyHandle);
    await page.getByLabel("Key", { exact: true }).fill(secret);
    await expect(page.getByLabel("Key", { exact: true })).toHaveAttribute("type", "password");
    await page.getByLabel("Sent only to").fill("api.example.com");
  });

  await step(
    "Save asks to confirm it's you; the password saves the item and opens it",
    async () => {
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
      await expect(dialog).toContainText("You stay confirmed for 5 minutes");
      await proof("step-up");
      const stepUpRes = page.waitForResponse(
        (r) => r.url().endsWith("/api/v1/vault/step-up") && r.ok(),
      );
      await dialog.getByLabel("Password").fill(DEMO.password);
      await dialog.getByRole("button", { name: "Confirm" }).click();
      token = (await (await stepUpRes).json()).data.token;
      expect(token, "step-up token").toBeTruthy();
      cleanup(purge(keyHandle));
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/vault/items/${keyHandle}$`));
      await expect(page.getByRole("heading", { name: keyTitle })).toBeVisible();
    },
  );

  await step("detail shows the key masked; page, API reads and list never carry it", async () => {
    const values = page.getByRole("listitem").filter({ hasText: /^Key/ });
    await expect(values).toContainText(MASK);
    await expect(
      page.getByRole("listitem").filter({ hasText: /^created · vault_ui/ }),
    ).toBeVisible();
    noSecretIn(await page.content(), "item page HTML");
    const read = await detail(keyHandle);
    expect(read.fields).toContain("value");
    expect(read.item.hosts).toEqual(["api.example.com"]);
    noSecretIn(JSON.stringify(read), "GET /vault/items/:handle");
    noSecretIn(JSON.stringify(await api.get("/vault")), "GET /vault");
    expect(await revealApi(keyHandle, "value")).toBe(secret); // stored, decryptable
  });
  await proof("api-key-masked");

  await step("Reveal shows the value, Hide masks it again", async () => {
    await page.getByRole("button", { name: "Reveal" }).click();
    await expect(page.getByText(secret)).toBeVisible();
    await proof("api-key-revealed");
    await page.getByRole("button", { name: "Hide" }).click();
    await expect(page.getByText(secret)).toHaveCount(0);
    await expect(page.getByText(MASK)).toBeVisible();
  });

  await step("Copy puts the value on the clipboard", async () => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByText(/Key copied; it's cleared from the clipboard/)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
    await expect(page.getByText(secret)).toHaveCount(0);
  });

  await step("Edit rotates the value (read back through the API)", async () => {
    await page.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Key" });
    await dialog.getByLabel("New value").fill(rotated);
    await expect(dialog.getByLabel("New value")).toHaveAttribute("type", "password");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Key saved")).toBeVisible();
    expect(await revealApi(keyHandle, "value")).toBe(rotated);
    noSecretIn(await page.content(), "item page after edit");
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: /^updated · vault_ui/ })
        .first(),
    ).toBeVisible();
  });

  await step("policy: When to use saves and survives a reload", async () => {
    await page.getByLabel("When to use").fill(`for verify ${stamp}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // Toasts stack here (Key saved, copied, Saved); assert the stored policy instead.
    await expect
      .poll(async () => (await detail(keyHandle)).item.whenToUse)
      .toBe(`for verify ${stamp}`);
    await page.reload();
    await expect(page.getByLabel("When to use")).toHaveValue(`for verify ${stamp}`);
    expect((await detail(keyHandle)).item.whenToUse).toBe(`for verify ${stamp}`);
  });

  await step("kill switch: turning the item off shows Off here and in the list", async () => {
    const sw = page.getByRole("switch", { name: "Let bots use this item" });
    await expect(sw).toBeChecked();
    await sw.click();
    // The reload above dropped the step-up token (page memory only): confirm again.
    const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
    await expect(dialog).toBeVisible();
    const stepUpRes = page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/vault/step-up") && r.ok(),
    );
    await dialog.getByLabel("Password").fill(DEMO.password);
    await dialog.getByRole("button", { name: "Confirm" }).click();
    token = (await (await stepUpRes).json()).data.token;
    await expect(page.getByText("Off", { exact: true })).toBeVisible();
    await expect.poll(async () => (await detail(keyHandle)).item.disabled).toBe(true);
    await toVault();
    const row = page.getByRole("link", { name: new RegExp(`^${keyTitle}`) });
    await expect(row).toContainText("off");
    await expect(row).toContainText("api.example.com");
  });

  await step("new login: generated password, username shown, password masked", async () => {
    await newItem("Login", "New login");
    await page.getByLabel("Name", { exact: true }).fill(loginTitle);
    await page.getByLabel("Website").fill("https://login.example.com/signin");
    await page.getByLabel("Username").fill(`user-${stamp}`);
    await page.getByRole("button", { name: "Generate a password" }).click();
    generated = await page.getByLabel("Password", { exact: true }).inputValue();
    expect(generated.length).toBeGreaterThanOrEqual(20);
    await page.getByRole("button", { name: "Save", exact: true }).click(); // step-up still fresh
    await expect(page).toHaveURL(new RegExp(`/vault/items/${loginHandle}$`));
    cleanup(purge(loginHandle));
    await expect(page.getByText(`user-${stamp}`)).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: /^Password/ })).toContainText(MASK);
    noSecretIn(await page.content(), "login page HTML");
    const read = await detail(loginHandle);
    expect(read.item.origins).toEqual(["https://login.example.com"]);
    noSecretIn(JSON.stringify(read), "GET login detail");
    expect(await revealApi(loginHandle, "password")).toBe(generated);
  });
  await proof("login");

  await step("new card: number masked, list shows brand and last 4 only", async () => {
    await newItem("Card", "New card");
    await page.getByLabel("Name", { exact: true }).fill(cardTitle);
    await page.getByLabel("Website").fill("https://shop.example.com");
    await page.getByLabel("Card number").fill(cardNumber);
    await page.getByLabel("Expiry").fill("12/2030");
    await page.getByLabel("Security code").fill("123");
    await page.getByLabel("Name on card").fill("Verify Holder");
    await expect(page.getByText("Cards always ask, every time.")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Use in routines" })).toBeDisabled();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/vault/items/${cardHandle}$`));
    cleanup(purge(cardHandle));
    await expect(page.getByRole("listitem").filter({ hasText: /^Card number/ })).toContainText(
      MASK,
    );
    noSecretIn(await page.content(), "card page HTML");
    const read = await detail(cardHandle);
    expect(read.item.approval).toBe("every_use");
    noSecretIn(JSON.stringify(read), "GET card detail");
    await toVault();
    await expect(page.getByRole("link", { name: new RegExp(`^${cardTitle}`) })).toContainText(
      "••4242",
    );
    noSecretIn(await page.content(), "vault list HTML");
  });
  await proof("list-by-kind");

  await step("new contact: lands under Contacts", async () => {
    await newItem("Contact", "New contact");
    await page.getByLabel("Name", { exact: true }).first().fill(contactTitle);
    await page
      .getByRole("textbox", { name: "Email", exact: true })
      .fill(`verify-${stamp}@example.com`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/vault/items/${contactHandle}$`));
    cleanup(purge(contactHandle));
    await toVault();
    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`^${contactTitle}`) })).toBeVisible();
  });

  await step(
    "Unlink only: the login moves to Not linked yet; Link gives it a handle again",
    async () => {
      await page.getByRole("link", { name: new RegExp(`^${loginTitle}`) }).click();
      await page.getByRole("button", { name: "Delete" }).click();
      await page
        .getByRole("dialog", { name: `Delete “${loginTitle}”?` })
        .getByRole("button", { name: "Unlink only" })
        .click();
      await expect(page.getByText("Unlinked", { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/vault$/);
      await expect(page.getByRole("heading", { name: "Not linked yet" })).toBeVisible();
      const row = page.getByRole("listitem").filter({ hasText: loginTitle });
      await expect(row).toContainText("Login");
      await proof("unlinked");
      await row.getByRole("button", { name: "Link" }).click();
      const dialog = page.getByRole("dialog", { name: `Let bots use “${loginTitle}”` });
      await expect(dialog.getByLabel("Handle")).toHaveValue(loginHandle);
      await dialog.getByRole("button", { name: "Link" }).click();
      await expect(page).toHaveURL(new RegExp(`/vault/items/${loginHandle}$`));
      expect(await revealApi(loginHandle, "password")).toBe(generated);
    },
  );

  await step("Delete everywhere removes the API key", async () => {
    await toVault();
    await page.getByRole("link", { name: new RegExp(`^${keyTitle}`) }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page
      .getByRole("dialog", { name: `Delete “${keyTitle}”?` })
      .getByRole("button", { name: "Delete everywhere" })
      .click();
    await expect(page.getByText("Deleted", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/vault$/);
    await expect(page.getByRole("link", { name: new RegExp(`^${keyTitle}`) })).toHaveCount(0);
    const res = await page.request.get(`/api/v1/vault/items/${keyHandle}`);
    expect(res.status()).toBe(404);
    expect(
      (await api.get("/vault")).unlinked.some((u) => u.title === keyTitle),
      "purged, not merely unlinked",
    ).toBe(false);
  });
  await proof("deleted");

  await step("a credential request that is not open shows Nothing to fill", async () => {
    await page.goto("/vault/requests/999999");
    await expect(page.getByRole("heading", { name: "Credential request" })).toBeVisible();
    await expect(page.getByText("Nothing to fill")).toBeVisible();
  });
  await proof("request-closed");

  await step("server log carries none of the secrets", async () => {
    const log = path.join(
      path.dirname(path.dirname(process.env.TA_VERIFY_EVIDENCE)),
      "verify",
      path.basename(process.env.TA_VERIFY_EVIDENCE),
      "server.log",
    );
    expect(existsSync(log), `server log at ${log}`).toBe(true);
    noSecretIn(readFileSync(log, "utf8"), "server.log");
  });

  await step("step-up: a wrong password is refused and the dialog stays open", async () => {
    await page.goto(`/vault/items/${loginHandle}`);
    await page.reload(); // the step-up token lives in page memory only
    await page
      .getByRole("listitem")
      .filter({ hasText: /^Password/ })
      .getByRole("button", { name: "Reveal" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
    await dialog.getByLabel("Password").fill("not-the-password");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Wrong password")).toBeVisible();
    await proof("step-up-refused");
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/vault/items/${loginHandle}$`));
  });
});
