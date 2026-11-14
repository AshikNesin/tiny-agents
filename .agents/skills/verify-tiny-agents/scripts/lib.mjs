/**
 * Journey harness for ta-verify. A journey is a plain Node module:
 *
 *   import { journey } from "../scripts/lib.mjs";
 *   await journey("tasks", async ({ page, step, proof, api }) => {
 *     await step("quick add", async () => { ... });
 *     await proof("after-add");
 *   });
 *
 * Register teardown for anything a journey creates with `cleanup(fn)` right
 * after creating it: cleanups run in reverse order even when a step fails, so
 * a failed drive leaves no rows behind to confuse the next one.
 *
 * Run it through `ta-verify drive <file>` (sets TA_VERIFY_URL / TA_VERIFY_EVIDENCE).
 * Evidence lands in <evidence>/<feature>/: one .png + .aria.yml per proof,
 * failure.png/.aria.yml on a failed step, and result.json with every step.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

export { expect };

export const DEMO = { email: "demo@example.com", password: "demo@example.com" }; // gitleaks:allow (documented dev-only demo account)
const BASE = process.env.TA_VERIFY_URL;
const EVIDENCE = process.env.TA_VERIFY_EVIDENCE;

/** A unique suffix per drive: the instance DB outlives a single journey. */
export const stamp = Date.now().toString(36);

async function launch() {
  const headless = process.env.TA_VERIFY_HEADED !== "1";
  const explicit = process.env.TA_VERIFY_CHROMIUM;
  if (explicit) return chromium.launch({ headless, executablePath: explicit });
  try {
    return await chromium.launch({ headless });
  } catch (error) {
    // Containers that pre-install one Chromium for a different Playwright.
    const fallback = "/opt/pw-browsers/chromium";
    if (/Executable doesn't exist/.test(String(error)) && existsSync(fallback)) {
      return chromium.launch({ headless, executablePath: fallback });
    }
    throw error;
  }
}

/** Sign in through the real login form as the seeded demo user. */
export async function login(page) {
  // domcontentloaded: a third-party embed (the feedback widget) can hold the
  // full load event long enough to time out an otherwise ready login page.
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email", { exact: true }).fill(DEMO.email);
  await page.getByLabel(/password/i).fill(DEMO.password);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/auth/login") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Sign In", exact: true }).click(),
  ]);
  // Name the cause: otherwise a rate-limited login reads as "still on /login".
  if (response.status() === 429)
    throw new Error(
      "login was rate-limited (429): `ta-verify up` sets AUTH_RATE_LIMIT_MAX; relaunch",
    );
  await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);
}

/**
 * Bring a chat's Browser or Computer live view on screen: the header's one
 * live view button opens the panel, and with a computer its tabs pick which.
 */
export async function showLiveView(page, which) {
  const panel = page.getByTestId(`${which}-panel`);
  const other = page.getByTestId(`${which === "browser" ? "computer" : "browser"}-panel`);
  if (!(await panel.isVisible()) && !(await other.isVisible()))
    await page.getByTestId("live-view-toggle").click();
  const tab = page.getByTestId(`live-view-tab-${which}`);
  if (await tab.isVisible()) await tab.click();
  await expect(panel).toBeVisible();
}

/** GET/POST/... through the page's cookie; returns the envelope's `data`. */
function makeApi(page) {
  const call = async (method, url, data) => {
    const res = await page.request.fetch(`/api/v1${url}`, { method, data });
    const body = await res.json().catch(() => ({}));
    if (!res.ok()) throw new Error(`${method} ${url} -> ${res.status()} ${JSON.stringify(body)}`);
    return body.data;
  };
  return {
    get: (url) => call("GET", url),
    post: (url, data) => call("POST", url, data),
    patch: (url, data) => call("PATCH", url, data),
    put: (url, data) => call("PUT", url, data),
    delete: (url) => call("DELETE", url),
  };
}

/** A stand-in for Vite's `/@vite/client`: the exports transformed modules import, no HMR socket. */
const NOOP_VITE_CLIENT = `
const noop = () => {};
export const createHotContext = () => ({ data: {}, accept: noop, acceptExports: noop, dispose: noop, prune: noop, invalidate: noop, decline: noop, on: noop, off: noop, send: noop });
const styleOf = (id) => document.querySelector('style[data-vite-dev-id="' + id + '"]');
export const updateStyle = (id, css) => {
  let style = styleOf(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    document.head.appendChild(style);
  }
  style.textContent = css;
};
export const removeStyle = (id) => styleOf(id)?.remove();
export const injectQuery = (url) => url;
export class ErrorOverlay {}
`;

/** Launch options of the current run (`up --sandbox`, `up --empty`). */
export const caps = new Set((process.env.TA_VERIFY_CAPS ?? "").split(",").filter(Boolean));
/** X-Admin-Auth-Key for this run (admin-only routes, e.g. POST /api/v1/auth/users). */
export const adminKey = process.env.TA_VERIFY_ADMIN_KEY;

/**
 * `requires`: launch options the journey needs, e.g. ["sandbox"], or
 * `env:NAME` for a variable the journey itself reads (real provider
 * credentials). Without them the journey records itself as unreachable
 * (exit 3) instead of failing.
 */
export async function journey(feature, fn, { signIn = true, requires = [] } = {}) {
  if (!BASE || !EVIDENCE) {
    console.error(
      "Run journeys through `ta-verify drive` (TA_VERIFY_URL / TA_VERIFY_EVIDENCE unset).",
    );
    process.exit(2);
  }
  const dir = path.join(EVIDENCE, feature);
  mkdirSync(dir, { recursive: true });
  const missing = requires.filter((cap) =>
    cap.startsWith("env:") ? !process.env[cap.slice(4)] : !caps.has(cap),
  );
  if (missing.length) {
    const flags = missing.filter((m) => !m.startsWith("env:"));
    const vars = missing.filter((m) => m.startsWith("env:")).map((m) => m.slice(4));
    const reason = [
      flags.length ? `\`ta-verify up ${flags.map((m) => `--${m}`).join(" ")}\`` : "",
      vars.length ? `${vars.join(", ")} in the environment` : "",
    ]
      .filter(Boolean)
      .join(" and ")
      .replace(/^/, "needs ");
    writeFileSync(
      path.join(dir, "result.json"),
      JSON.stringify({ feature, ok: false, unreachable: reason, base: BASE }, null, 2),
    );
    console.log(`UNREACHABLE ${feature}: ${reason}`);
    process.exit(3);
  }
  const steps = [];
  const browser = await launch();
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 860 },
  });
  // The instance is a Vite dev server: its HMR client would push live updates,
  // even full reloads, into the page when anything in the checkout changes
  // mid-drive. Serve a no-op client instead (CSS injection still works). Do NOT
  // use context.routeWebSocket for this: any WebSocket route makes Playwright
  // proxy every socket, and noVNC live views then never leave "Reconnecting".
  await context.route("**/@vite/client", (route) =>
    route.fulfill({ contentType: "application/javascript", body: NOOP_VITE_CLIENT }),
  );
  // index.html loads a third-party feedback widget (feedbackbee) with an async
  // script, which still holds the page's load event: a slow answer stalls every
  // page.goto/reload that waits for "load". Fetch it with a 5 s cap and abort
  // when slower; the app then shows its "Feedback isn't available" path.
  await context.route("https://feedbackbee.nesin.workers.dev/**", async (route) => {
    try {
      await route.fulfill({ response: await route.fetch({ timeout: 5_000 }) });
    } catch {
      await route.abort().catch(() => {});
    }
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  // Browser console errors (React warnings such as invalid DOM nesting, failed
  // fetches): recorded, not failing. The no-op Vite client no longer forwards
  // them to the dev server's log, so this is the only place they show up.
  const consoleErrors = [];
  context.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
  });

  const proof = async (label) => {
    await page.screenshot({ path: path.join(dir, `${label}.png`), fullPage: false });
    const aria = await page.locator("body").ariaSnapshot();
    writeFileSync(path.join(dir, `${label}.aria.yml`), `# ${page.url()}\n${aria}\n`);
    steps.push({ proof: label, url: page.url() });
  };
  const step = async (name, body) => {
    const started = Date.now();
    try {
      await body();
      steps.push({ step: name, ok: true, ms: Date.now() - started });
      console.log(`  ok   ${feature}: ${name}`);
    } catch (error) {
      steps.push({
        step: name,
        ok: false,
        ms: Date.now() - started,
        error: String(error).slice(0, 2000),
      });
      console.log(
        `  FAIL ${feature}: ${name}\n       ${String(error).split("\n").slice(0, 4).join("\n       ")}`,
      );
      throw error;
    }
  };

  const cleanups = [];
  const cleanup = (fn) => cleanups.push(fn);
  let ok = false;
  try {
    if (signIn) await step("sign in as demo user", () => login(page));
    await fn({ page, context, step, proof, cleanup, api: makeApi(page), stamp });
    ok = true;
  } catch {
    await proof("failure").catch(() => {});
  } finally {
    for (const fn of cleanups.reverse()) {
      try {
        await fn();
        steps.push({ cleanup: true, ok: true });
      } catch (error) {
        ok = false;
        steps.push({ cleanup: true, ok: false, error: String(error).slice(0, 500) });
        console.log(`  FAIL ${feature}: cleanup: ${String(error).split("\n")[0]}`);
      }
    }
    writeFileSync(
      path.join(dir, "result.json"),
      JSON.stringify(
        { feature, ok, base: BASE, at: new Date().toISOString(), steps, pageErrors, consoleErrors },
        null,
        2,
      ),
    );
    await browser.close();
  }
  console.log(`${ok ? "PASS" : "FAIL"} ${feature} -> ${dir}`);
  process.exit(ok ? 0 : 1);
}
