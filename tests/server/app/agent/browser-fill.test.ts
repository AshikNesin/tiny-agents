/**
 * Vault fills in a real Chromium (issue #56): the login/payment classifier,
 * the origin assertion, and that nothing of the value comes back. Skipped
 * where no Chromium binary is available (set CHROMIUM_PATH to point at one).
 */
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  fillSecretFields,
  OriginMismatchError,
  pageOrigin,
} from "../../../../packages/sandbox/src/browser-fill";
import { SecretValue, VaultTargetMovedError } from "../../../../packages/agent/src/vault";

const executable = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/headless-shell/headless-shell",
].find((path): path is string => Boolean(path && existsSync(path)));

const LOGIN = `<!doctype html><form>
  <label for="u">Email</label><input id="u" name="email" type="email">
  <label for="p">Password</label><input id="p" name="pw" type="password">
  <input type="hidden" name="csrf" value="x">
</form>
<script>
  window.events = [];
  for (const el of document.querySelectorAll("input")) el.addEventListener("input", () => events.push(el.id));
</script>`;

const CHECKOUT = `<!doctype html><form>
  <input name="cardnumber" autocomplete="cc-number">
  <input name="exp" placeholder="MM / YY" autocomplete="cc-exp">
  <input name="cvc" placeholder="CVC">
  <input name="holder" placeholder="Name on card">
</form>`;

/** Amazon's sign-in as amazon.in serves it: the email step first, with an
 * `autocomplete="webauthn"` email field and a hidden password autofill
 * hint; the password on a page of its own after submitting. */
const EMAIL_STEP = `<!doctype html><form action="/password" method="get">
  <input type="text" name="email" id="ap_email_login" autocomplete="webauthn">
  <input type="password" name="password" id="hint" style="display:none">
  <input type="submit" value="Continue">
</form>`;

const PASSWORD_STEP = `<!doctype html><form action="/done" method="get">
  <input type="password" name="password" id="ap_password" autocomplete="current-password">
</form>`;

const OTP = `<!doctype html><form><input name="otp" inputmode="numeric" placeholder="Verification code"></form>`;

describe.skipIf(!executable)("vault fills in the page", () => {
  let browser: Browser;
  let server: Server;
  let origin: string;
  let page: Page;
  const submitted: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      if (path === "/password") submitted.push(req.url ?? "");
      const body =
        path === "/checkout"
          ? CHECKOUT
          : path === "/otp"
            ? OTP
            : path === "/email"
              ? EMAIL_STEP
              : path === "/password"
                ? PASSWORD_STEP
                : LOGIN;
      res.writeHead(200, { "content-type": "text/html" }).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ executablePath: executable, args: ["--no-sandbox"] });
    page = await browser.newPage();
    // Launching Chromium shares the CI machine with the suite's tsc-heavy
    // checks (kit-exports, typecheck-coverage), and once missed 30 s there.
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it("fills a login form found by its markup and fires input events", async () => {
    await page.goto(`${origin}/login`);
    expect(await pageOrigin(page)).toBe(origin);
    const result = await fillSecretFields(page, {
      origin,
      fields: [
        { key: "username", autocomplete: "username", value: new SecretValue("ana@example.com") },
        {
          key: "password",
          autocomplete: "current-password",
          value: new SecretValue("canary-pw-9Q"),
        },
      ],
    });
    expect(result).toEqual({ filled: ["username", "password"] });
    expect(JSON.stringify(result)).not.toContain("canary");
    expect(await page.inputValue("#u")).toBe("ana@example.com");
    expect(await page.inputValue("#p")).toBe("canary-pw-9Q");
    expect(await page.evaluate(() => (window as unknown as { events: string[] }).events)).toEqual([
      "u",
      "p",
    ]);
  });

  it("refuses to fill when the page is on another origin, naming where it is", async () => {
    await page.goto(`${origin}/login`);
    const error = await fillSecretFields(page, {
      origin: "https://github.com",
      fields: [
        { key: "password", autocomplete: "current-password", value: new SecretValue("canary-2") },
      ],
    }).catch((caught: unknown) => caught);
    // The vault's one "target moved" error: what the app audits as refused_origin.
    expect(error).toBeInstanceOf(OriginMismatchError);
    expect(error).toBeInstanceOf(VaultTargetMovedError);
    expect(error).toMatchObject({ actual: origin, reason: "page origin changed before the fill" });
    expect(await page.inputValue("#p")).toBe("");
  });

  it("fills a card by autocomplete tokens and labels", async () => {
    await page.goto(`${origin}/checkout`);
    const result = await fillSecretFields(page, {
      origin,
      fields: [
        {
          key: "card_number",
          autocomplete: "cc-number",
          value: new SecretValue("4242424242424242"),
        },
        { key: "card_expiry", autocomplete: "cc-exp", value: new SecretValue("12/30") },
        { key: "card_expiry_month", autocomplete: "cc-exp-month", value: new SecretValue("12") },
        { key: "card_cvc", autocomplete: "cc-csc", value: new SecretValue("123") },
        { key: "card_holder", autocomplete: "cc-name", value: new SecretValue("Ana Lima") },
      ],
    });
    // The split month field doesn't exist on a combined-expiry form.
    expect(result.filled).toEqual(["card_number", "card_expiry", "card_cvc", "card_holder"]);
    expect(await page.inputValue("[name=exp]")).toBe("12/30");
    expect(await page.inputValue("[name=cvc]")).toBe("123");
  });

  it("finds a one-time code field without autocomplete", async () => {
    await page.goto(`${origin}/otp`);
    const result = await fillSecretFields(page, {
      origin,
      fields: [{ key: "code", autocomplete: "one-time-code", value: new SecretValue("123456") }],
    });
    expect(result.filled).toEqual(["code"]);
    expect(await page.inputValue("[name=otp]")).toBe("123456");
  });

  it("reports a field it can't find as not filled", async () => {
    await page.goto(`${origin}/otp`);
    const result = await fillSecretFields(page, {
      origin,
      fields: [
        { key: "password", autocomplete: "current-password", value: new SecretValue("canary-3") },
      ],
    });
    expect(result.filled).toEqual([]);
  });

  it("fills a two-step sign-in: the email, submits it, then the password on the next page", async () => {
    await page.goto(`${origin}/email`);
    const result = await fillSecretFields(page, {
      origin,
      steps: true,
      fields: [
        { key: "email", autocomplete: "username", value: new SecretValue("ana@example.com") },
        { key: "password", autocomplete: "current-password", value: new SecretValue("canary-4") },
      ],
    });
    expect(result).toEqual({ filled: ["email", "password"] });
    expect(submitted).toEqual(["/password?email=ana%40example.com&password="]);
    expect(new URL(page.url()).pathname).toBe("/password");
    expect(await page.inputValue("#ap_password")).toBe("canary-4");
  });
});
