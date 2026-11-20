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
  FrameOriginError,
  OriginMismatchError,
  pageOrigin,
  refOrigin,
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

/** A mobile-number sign-in as SPA portals serve it: no `<form>` (a
 * styled-components tree), a country-code prefix, and the only identifier
 * field is a `tel` input; the header re-renders, replacing its LOGIN button
 * every 300ms. */
const MOBILE_LOGIN = `<!doctype html><body>
<div id="header"><button id="login">LOGIN/SIGNUP</button></div>
<section id="login-section">
  <div>+91</div>
  <input id="mobile" type="tel" inputmode="numeric" maxlength="10"
         placeholder="Enter your mobile number" aria-label="Enter your mobile number">
  <button id="continue">Continue</button>
</section>
<script>
  // The header re-renders: the button is detached and replaced every 300ms.
  setInterval(() => {
    const btn = document.createElement("button");
    btn.textContent = "LOGIN/SIGNUP";
    document.getElementById("header").replaceChildren(btn);
  }, 300);
  document.getElementById("continue").addEventListener("click", () => {
    if (!document.getElementById("mobile").value) return;
    setTimeout(() => {
      const otp = document.createElement("input");
      otp.id = "otp"; otp.type = "tel"; otp.maxLength = 4; otp.inputMode = "numeric";
      otp.placeholder = "Enter OTP"; otp.setAttribute("aria-label", "Enter OTP");
      document.getElementById("login-section").replaceChildren(otp);
    }, 300);
  });
</script>
</body>`;

const OTP = `<!doctype html><form><input name="otp" inputmode="numeric" placeholder="Verification code"></form>`;

describe.skipIf(!executable)("vault fills in the page", () => {
  let browser: Browser;
  let server: Server;
  let origin: string;
  /** The same server by another name: a different origin that frames `origin`'s login. */
  let framer: string;
  const framedLogin = () => `<!doctype html><iframe src="${origin}/login"></iframe>`;
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
                : path === "/mobile"
                  ? MOBILE_LOGIN
                  : path === "/framed"
                    ? framedLogin()
                    : LOGIN;
      res.writeHead(200, { "content-type": "text/html" }).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    framer = `http://localhost:${(server.address() as AddressInfo).port}`;
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

  it("names the frame when the field sits in another site's frame (#302)", async () => {
    // The Hindu's sign-in: the page is on the asked origin, the email field
    // in an id.tinypass.com frame. Here localhost frames a 127.0.0.1 page.
    await page.goto(`${framer}/framed`);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    await frame?.waitForSelector("#u");
    const snapshot = await page.locator("body").ariaSnapshot({ mode: "ai" });
    const ref = /textbox "Email" \[ref=(f\d+e\d+)\]/.exec(snapshot)?.[1];
    expect(ref).toBeDefined();
    const error = await fillSecretFields(page, {
      origin: framer,
      fields: [
        { key: "email", autocomplete: "username", value: new SecretValue("a@b.c"), ref: ref! },
      ],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FrameOriginError);
    expect(error).toMatchObject({ actual: origin });
    expect(await frame!.inputValue("#u")).toBe("");
    // What a credential request records, so the card can name the frame.
    expect(await refOrigin(page, ref!)).toBe(origin);
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

  it("fills a mobile-number sign-in: no <form>, a tel input, a re-rendering header", async () => {
    await page.goto(`${origin}/mobile`);
    const result = await fillSecretFields(page, {
      origin,
      fields: [{ key: "mobile", autocomplete: "tel", value: new SecretValue("8124227227") }],
    });
    expect(result.filled).toEqual(["mobile"]);
    expect(await page.inputValue("#mobile")).toBe("8124227227");
  });

  it("fills a mobile-only sign-in asked for as a username, then its OTP screen", async () => {
    await page.goto(`${origin}/mobile`);
    const result = await fillSecretFields(page, {
      origin,
      // A sign-in asked for as "username" (the default text token) on a page
      // whose only identifier field is a mobile-number tel input.
      fields: [{ key: "mobile", autocomplete: "username", value: new SecretValue("8124227227") }],
      steps: true,
    });
    expect(result).toEqual({ filled: ["mobile"] });
    expect(await page.inputValue("#mobile")).toBe("8124227227");
    // As the tool tells the model to: submit, then the OTP screen shows.
    await page.click("#continue");
    await page.waitForSelector("#otp");
    // The OTP screen (4-digit tel input) is filled by the one-time-code heuristic.
    const otp = await fillSecretFields(page, {
      origin,
      fields: [{ key: "code", autocomplete: "one-time-code", value: new SecretValue("4587") }],
    });
    expect(otp.filled).toEqual(["code"]);
    expect(await page.inputValue("#otp")).toBe("4587");
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
