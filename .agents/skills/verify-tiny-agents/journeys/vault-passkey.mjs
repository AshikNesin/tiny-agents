// Feature: vault-passkey (features/vault-passkey.md). Vault step-up with a passkey: a fresh
// owner (no passkeys yet) on a "shared laptop" (a CDP virtual authenticator that also holds a
// guest's passkey) is refused with the guest's passkey and stays signed in; after the guest is
// removed, the guest's leftover passkey is refused the same way (#164 class: must not sign the
// owner out); the owner registers a passkey on their own device, reveals a value with
// "Use a passkey" (POST /vault/step-up/options + /vault/step-up) and edits it in the same
// confirmed window; a different authenticator without the owner's passkey is refused in the
// browser, again without signing the owner out.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { journey, expect, adminKey } from "../scripts/lib.mjs";

const AUTHENTICATOR = {
  protocol: "ctap2",
  transport: "internal",
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
};
const MASK = "••••••••••";

await journey(
  "vault-passkey",
  async ({ page, context, step, proof, cleanup, api, stamp }) => {
    const owner = {
      name: `Vault Owner ${stamp}`,
      email: `vault-owner-${stamp}@example.com`,
      password: `owner-pass-${stamp}`, // gitleaks:allow (throwaway test password)
    };
    const guest = {
      name: `Vault Guest ${stamp}`,
      email: `vault-guest-${stamp}@example.com`,
      password: `guest-pass-${stamp}`, // gitleaks:allow (throwaway test password)
    };
    const handle = `verify-pk-key-${stamp}`;
    const secret = `sk-passkey-${stamp}-CCCC3333`;
    const rotated = `sk-passkey-${stamp}-DDDD4444`;
    const ownerPasskey = `vault-pk-${stamp}`;
    const guestPasskey = `vault-guest-pk-${stamp}`;
    const itemPath = `/vault/items/${handle}`;
    const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
    const keyRow = page.getByRole("listitem").filter({ hasText: /^Key/ });
    let cdp;
    let shared; // the owner's "shared laptop" authenticator
    let token; // a step-up token for API read-backs and cleanup
    let guestId;
    let guestPage;
    const bugs = [];
    const bugStep = async (name, body) => {
      try {
        await step(name, body);
      } catch {
        bugs.push(name);
        await proof(`bug-${bugs.length}`);
      }
    };

    // Every step-up call the owner's page makes.
    const stepUps = [];
    page.on("response", (res) => {
      const url = new URL(res.url());
      if (/^\/api\/v1\/vault\/step-up(\/options)?$/.test(url.pathname))
        stepUps.push({ path: url.pathname, status: res.status() });
    });
    const signInForm = async (p, who, landing = /\/chats(\/[^/]+)?$/) => {
      await p.goto("/login", { waitUntil: "domcontentloaded" });
      await p.getByLabel("Email", { exact: true }).fill(who.email);
      await p.getByLabel(/password/i).fill(who.password);
      await p.getByRole("button", { name: "Sign In", exact: true }).click();
      await expect(p).toHaveURL(landing);
    };
    const me = async () => {
      const res = await page.request.get("/api/v1/auth/me");
      return res.ok() ? (await res.json()).data.email : res.status();
    };
    const passwordStepUp = async () => {
      const res = await page.request.post("/api/v1/vault/step-up", {
        data: { password: owner.password },
      });
      expect(res.status(), "password step-up").toBe(200);
      return (await res.json()).data.token;
    };
    const revealApi = async () => {
      const res = await page.request.post(`/api/v1/vault/items/${handle}/reveal`, {
        headers: { "X-Vault-Step-Up": token },
        data: { field: "value", purpose: "reveal" },
      });
      expect(res.status(), "API reveal").toBe(200);
      return (await res.json()).data.value;
    };
    /** Fresh page load (no step-up token in memory), then Reveal → Confirm it's you. */
    const openRevealPrompt = async () => {
      await page.goto(itemPath);
      await expect(page.getByRole("heading", { name: `Passkey key ${stamp}` })).toBeVisible();
      await expect(keyRow).toContainText(MASK);
      await keyRow.getByRole("button", { name: "Reveal" }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Use a passkey" })).toBeEnabled();
    };
    const usePasskey = async () => {
      stepUps.length = 0;
      await dialog.getByRole("button", { name: "Use a passkey" }).click();
    };
    /** Refused: the prompt stays, the value stays masked, the owner is still signed in. */
    const expectRefusedInPlace = async () => {
      await expect(dialog).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${itemPath}$`));
      await expect(page.getByText(secret)).toHaveCount(0);
      expect(await me()).toBe(owner.email);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${itemPath}$`));
      await expect(page.getByRole("heading", { name: `Passkey key ${stamp}` })).toBeVisible();
    };
    const swapAuthenticator = async (current) => {
      if (current)
        await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: current });
      return (await cdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTHENTICATOR }))
        .authenticatorId;
    };

    await step(
      "setup: a fresh owner account (admin API), signed in through the login form",
      async () => {
        // A fresh owner has no passkeys, so the browser offers any passkey on the device
        // (empty allowCredentials): the only way another account's passkey reaches the server.
        const res = await page.request.post("/api/v1/auth/users", {
          headers: { "X-Admin-Auth-Key": adminKey },
          data: owner,
        });
        expect(res.status(), await res.text()).toBe(201);
        await signInForm(page, owner);
        expect(await me()).toBe(owner.email);
        expect(await api.get("/passkey/list")).toEqual([]);
      },
    );

    await step("setup: an API-key vault item (password step-up, API)", async () => {
      token = await passwordStepUp();
      const res = await page.request.post("/api/v1/vault/items", {
        headers: { "X-Vault-Step-Up": token },
        data: {
          kind: "api_key",
          title: `Passkey key ${stamp}`,
          values: { value: secret },
          policy: { handle, hosts: ["api.example.com"] },
        },
      });
      expect(res.status(), await res.text()).toBe(201);
      cleanup(async () => {
        if ((await me()) !== owner.email) {
          // Signed out (a failed step): sign the request context back in first.
          const login = await page.request.post("/api/v1/auth/login", {
            data: { email: owner.email, password: owner.password },
          });
          expect(login.status()).toBe(200);
        }
        const purge = (t) =>
          page.request.delete(`/api/v1/vault/items/${handle}?purge=true`, {
            headers: { "X-Vault-Step-Up": t },
          });
        let del = await purge(token);
        if (del.status() === 403) del = await purge(await passwordStepUp()); // token expired
        expect([200, 404]).toContain(del.status());
        expect((await page.request.get(`/api/v1/vault/items/${handle}`)).status()).toBe(404);
      });
      expect(await revealApi()).toBe(secret);
    });

    await step("setup: a guest who registers a passkey on the shared laptop", async () => {
      guestId = (await api.post("/people", guest)).id;
      cleanup(async () => {
        if ((await api.get("/people")).guests.some((g) => g.id === guestId))
          await api.delete(`/people/${guestId}`);
      });
      const guestContext = await context.browser().newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1280, height: 860 },
      });
      cleanup(() => guestContext.close());
      await guestContext.route("https://feedbackbee.nesin.io/**", (r) => r.abort());
      guestPage = await guestContext.newPage();
      const guestCdp = await guestContext.newCDPSession(guestPage);
      await guestCdp.send("WebAuthn.enable");
      const { authenticatorId } = await guestCdp.send("WebAuthn.addVirtualAuthenticator", {
        options: AUTHENTICATOR,
      });
      await signInForm(guestPage, guest);
      // A guest's Settings has two sections: Appearance and Security.
      await guestPage.goto("/settings/security");
      await expect(guestPage.getByRole("heading", { name: "Add a passkey" })).toBeVisible();
      await guestPage.getByLabel("Name (optional)").fill(guestPasskey);
      await guestPage.getByRole("button", { name: "Add passkey" }).click();
      await expect(guestPage.getByText("Passkey added successfully")).toBeVisible();
      const dir = path.join(process.env.TA_VERIFY_EVIDENCE, "vault-passkey");
      await guestPage.screenshot({ path: path.join(dir, "guest-passkey.png") });
      writeFileSync(
        path.join(dir, "guest-passkey.aria.yml"),
        `# ${guestPage.url()}\n${await guestPage.locator("body").ariaSnapshot()}\n`,
      );
      // The same laptop: the owner's browser holds the guest's (discoverable) passkey too.
      const { credentials } = await guestCdp.send("WebAuthn.getCredentials", { authenticatorId });
      expect(credentials).toHaveLength(1);
      cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      shared = await swapAuthenticator();
      await cdp.send("WebAuthn.addCredential", {
        authenticatorId: shared,
        credential: credentials[0],
      });
    });

    await step("the guest's passkey is refused (403) and the owner stays signed in", async () => {
      await openRevealPrompt();
      await proof("step-up-prompt");
      await usePasskey();
      await expect(page.getByText("That passkey belongs to someone else")).toBeVisible();
      expect(stepUps).toEqual([
        { path: "/api/v1/vault/step-up/options", status: 200 },
        { path: "/api/v1/vault/step-up", status: 403 },
      ]);
      await proof("someone-else-refused");
      await expectRefusedInPlace();
    });

    await step("setup: remove the guest (its passkeys go with the account; API)", async () => {
      await api.delete(`/people/${guestId}`);
      expect((await api.get("/people")).guests.some((g) => g.id === guestId)).toBe(false);
    });

    // Before the owner has a passkey of their own: afterwards the browser offers only theirs.
    await bugStep(
      "a removed guest's leftover passkey is refused without signing the owner out",
      async () => {
        await openRevealPrompt();
        await usePasskey();
        await expect(page.getByText("Passkey not found")).toBeVisible();
        await expect.poll(() => stepUps.length, { timeout: 15_000 }).toBe(2);
        const refusal = stepUps[1];
        await proof("leftover-refused");
        expect(refusal.status, "POST /vault/step-up is a plain 401, not SESSION_INVALID").toBe(401);
        await expectRefusedInPlace();
      },
    );
    if (
      bugs.length &&
      (await page.request.get("/api/v1/auth/me")).ok() &&
      /\/login/.test(page.url())
    ) {
      // The shell dropped the session although the cookie is valid: sign in again to go on.
      // Login returns to the page the session ended on (the item).
      await step("recover: sign the owner in again", () =>
        signInForm(page, owner, new RegExp(`${itemPath}$`)),
      );
    }

    await step(
      "register the owner's own passkey on their device (Settings → Security)",
      async () => {
        shared = await swapAuthenticator(shared);
        await page.goto("/settings/security");
        await page.getByLabel("Name (optional)").fill(ownerPasskey);
        await page.getByRole("button", { name: "Add passkey" }).click();
        await expect(page.getByText("Passkey added successfully")).toBeVisible();
        expect((await api.get("/passkey/list")).map((p) => p.credentialName)).toEqual([
          ownerPasskey,
        ]);
      },
    );

    await step("Reveal → Use a passkey: confirmed, the value shows", async () => {
      await openRevealPrompt();
      const confirmed = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/v1/vault/step-up" && r.ok(),
      );
      await usePasskey();
      token = (await (await confirmed).json()).data.token; // the passkey's step-up token
      await expect(dialog).toHaveCount(0);
      await expect(keyRow).toContainText(secret);
      expect(stepUps).toEqual(
        expect.arrayContaining([
          { path: "/api/v1/vault/step-up/options", status: 200 },
          { path: "/api/v1/vault/step-up", status: 200 },
        ]),
      );
      const used = (await api.get("/passkey/list")).find((p) => p.credentialName === ownerPasskey);
      expect(used.lastUsedAt, "the passkey records its use").toBeTruthy();
    });
    await proof("revealed-with-passkey");

    await step("Edit in the same confirmed window: no new prompt, the value changes", async () => {
      await keyRow.getByRole("button", { name: "Hide" }).click();
      await expect(keyRow).toContainText(MASK);
      stepUps.length = 0;
      await keyRow.getByRole("button", { name: "Edit" }).click();
      const edit = page.getByRole("dialog", { name: "Key" });
      await edit.getByLabel("New value").fill(rotated);
      const saved = page.waitForResponse(
        (r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/v1${itemPath}`,
      );
      await edit.getByRole("button", { name: "Save" }).click();
      expect((await saved).status()).toBe(200);
      await expect(page.getByText("Key saved")).toBeVisible();
      await expect(dialog).toHaveCount(0);
      expect(stepUps, "no second confirmation inside the 5 minutes").toEqual([]);
      expect(await revealApi()).toBe(rotated); // the passkey's token works for the API too
      await expect(page.getByText(rotated)).toHaveCount(0);
    });
    await proof("edited");

    await step(
      "another authenticator without the owner's passkey: refused, still signed in",
      async () => {
        shared = await swapAuthenticator(shared);
        await openRevealPrompt();
        await usePasskey();
        // The browser finds no allowed credential: nothing reaches POST /vault/step-up.
        await expect(page.getByText(/not allowed|timed out/i)).toBeVisible({ timeout: 30_000 });
        expect(stepUps).toEqual([{ path: "/api/v1/vault/step-up/options", status: 200 }]);
        await proof("other-device-refused");
        await expectRefusedInPlace();
      },
    );

    if (bugs.length) throw new Error(`product bug(s): ${bugs.join("; ")}`);
  },
  { signIn: false },
);
