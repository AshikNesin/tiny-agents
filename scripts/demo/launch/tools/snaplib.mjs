// Snapshots of the real tiny-agents UI for the film.
//
// The film shows the product's own markup and styles, not a redraw. This
// library drives a running app (the verify-tiny-agents instance) and writes:
//   assets/app.<mode>.css   the app's stylesheet, flattened for one viewport
//   assets/fonts/*          the fonts that stylesheet names
//   assets/avatars/*        bot avatars
//   snap/<mode>/<name>.html the <body> markup of one app state
//   snap/<mode>/<name>.png  what the live app looked like, for comparison
//
// "Flattened" means every viewport-dependent rule is resolved at capture time:
// width media queries are kept or dropped for the app window's size, and
// vh/vw units become --app-h/--app-w. The markup can then sit inside a
// 1280x720 (or 390x844) box on a 1920x1080 film frame and lay out as it did
// in the app.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import postcss from "postcss";
import path from "node:path";

const require = createRequire(import.meta.url);
export const { chromium } = require("playwright");

export const ROOT = path.resolve(import.meta.dirname, "..");
export const BASE = process.env.TA_URL ?? "http://localhost:3100";
export const SIZES = { desktop: { width: 1280, height: 720 }, mobile: { width: 390, height: 844 } };

/** A signed-in page in the light theme. `mode` is "desktop" or "mobile". */
export async function open(
  mode = "desktop",
  { email = "demo@example.com", password = email } = {},
) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: SIZES[mode],
    deviceScaleFactor: 1,
    colorScheme: "light",
    hasTouch: mode === "mobile",
    isMobile: mode === "mobile",
    baseURL: BASE,
  });
  await ctx.addInitScript(() => localStorage.setItem("groot.theme", "light"));
  const page = await ctx.newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.waitForLoadState("networkidle").catch(() => {});
  return { browser, ctx, page, mode };
}

/** Calls /api/v1 with the page's session and returns the envelope's data. */
export async function api(page, method, url, body) {
  const res = await page.request.fetch(`/api/v1${url}`, { method, data: body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok())
    throw new Error(`${method} ${url} -> ${res.status()} ${JSON.stringify(json).slice(0, 300)}`);
  return json.data ?? json;
}

/**
 * Adds the page's live stylesheets to assets/app.<mode>.css. Call it on every
 * distinct page you snapshot: lazily loaded pages bring their own styles. Each
 * stylesheet is kept once (assets/.css/<mode>/), so calls only ever add.
 */
export async function dumpCss(page, mode) {
  const sheets = await page.evaluate(() => {
    const flat = (rules) => {
      const out = [];
      for (const r of rules) {
        if (r instanceof CSSMediaRule) {
          if (matchMedia(r.conditionText).matches) out.push(...flat(r.cssRules));
        } else if (r instanceof CSSSupportsRule) {
          if (CSS.supports(r.conditionText)) out.push(...flat(r.cssRules));
        } else if (r instanceof CSSLayerBlockRule) {
          out.push(`@layer ${r.name} {\n${flat(r.cssRules).join("\n")}\n}`);
        } else if (r instanceof CSSStyleRule && r.cssRules.length) {
          out.push(`${r.selectorText} { ${r.style.cssText} ${flat(r.cssRules).join(" ")} }`);
        } else if (
          typeof CSSNestedDeclarations !== "undefined" &&
          r instanceof CSSNestedDeclarations
        ) {
          out.push(r.style.cssText);
        } else {
          out.push(r.cssText);
        }
      }
      return out;
    };
    return [...document.styleSheets].map((s) => {
      try {
        return flat(s.cssRules).join("\n");
      } catch {
        return "";
      }
    });
  });

  const parts = path.join(ROOT, "assets/.css", mode);
  mkdirSync(parts, { recursive: true });
  mkdirSync(path.join(ROOT, "assets/fonts"), { recursive: true });
  for (let css of sheets) {
    if (!css.trim()) continue;
    // Only the Latin faces: the film's text is Latin, and the rest is megabytes.
    css = css.replace(/@font-face\s*{[^}]*}/g, (face) =>
      /cyrillic|greek|vietnamese|symbols|math/i.test(face) ? "" : face,
    );
    const urls = [...new Set([...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]))];
    for (const url of urls) {
      if (url.startsWith("data:")) continue;
      const name = path.basename(url.split("?")[0]);
      const file = path.join(ROOT, "assets/fonts", name);
      if (!existsSync(file)) {
        const res = await page.request.get(url);
        if (!res.ok()) throw new Error(`font ${url} -> ${res.status()}`);
        writeFileSync(file, await res.body());
      }
      css = css.replaceAll(`url("${url}")`, `url("fonts/${name}")`);
    }
    // Viewport units follow the app window, not the film frame. Only in values:
    // class names such as h-[85vh] must keep matching the markup.
    css = unitsToAppWindow(css);
    const hash = createHash("sha1").update(css).digest("hex").slice(0, 12);
    const have = readdirSync(parts);
    if (!have.some((f) => f.endsWith(`-${hash}.css`)))
      writeFileSync(path.join(parts, `${String(have.length).padStart(3, "0")}-${hash}.css`), css);
  }
  const all = readdirSync(parts)
    .sort()
    .map((f) => repairSelectors(readFileSync(path.join(parts, f), "utf8")));
  const file = path.join(ROOT, `assets/app.${mode}.css`);
  writeFileSync(
    file,
    `/* Generated by tools/snaplib.mjs from the running app. Do not edit. */\n${all.join("\n")}\n`,
  );
  return file;
}

const UNIT = /(-?\d*\.?\d+)[dsl]?v([hw])\b/g;
/** Rewrites vh/vw in declaration values to shares of --app-h/--app-w. */
export function unitsToAppWindow(css) {
  const root = postcss.parse(css);
  root.walkDecls((d) => {
    d.value = d.value.replace(
      UNIT,
      (_, n, axis) => `calc(var(--app-${axis}) * ${Number(n) / 100})`,
    );
  });
  return root.toString();
}

/**
 * Undoes an earlier bug that also rewrote the units inside selectors. The
 * unit's flavour (vh, dvh, svh, lvh) was lost, so the selector is restored
 * once for each: only the one the markup uses will ever match.
 */
export function repairSelectors(css) {
  const BAD = /calc\(var\(--app-([hw])\) \* ([\d.e-]+)\)/;
  if (!BAD.test(css)) return css;
  const root = postcss.parse(css);
  root.walkRules((r) => {
    if (!BAD.test(r.selector)) return;
    let list = [r.selector];
    while (list.some((sel) => BAD.test(sel)))
      list = list.flatMap((sel) =>
        ["", "d", "s", "l"].map((u) =>
          sel.replace(BAD, (_, axis, n) => `${+(Number(n) * 100).toFixed(4)}${u}v${axis}`),
        ),
      );
    r.selector = list.join(", ");
  });
  return root.toString();
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Saves the current app state as snap/<mode>/<name>.html and .png.
 * Form values, scroll offsets and canvases are baked into the markup.
 */
export async function snap({ page, mode }, name) {
  const dir = path.join(ROOT, "snap", mode);
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(ROOT, "assets/avatars"), { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });

  const { html, bodyClass, bodyStyle } = await page.evaluate(() => {
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (el.tagName === "TEXTAREA") el.textContent = el.value;
      else if (el.type === "checkbox" || el.type === "radio")
        el.toggleAttribute("checked", el.checked);
      else el.setAttribute("value", el.value);
    }
    for (const el of document.body.querySelectorAll("*")) {
      if (el.scrollTop) el.setAttribute("data-st", String(Math.round(el.scrollTop)));
      else el.removeAttribute("data-st");
      if (el.scrollLeft) el.setAttribute("data-sl", String(Math.round(el.scrollLeft)));
    }
    const live = [...document.body.querySelectorAll("canvas")];
    const clone = document.body.cloneNode(true);
    [...clone.querySelectorAll("canvas")].forEach((c, i) => {
      const img = document.createElement("img");
      for (const a of c.attributes)
        if (a.name !== "width" && a.name !== "height") img.setAttribute(a.name, a.value);
      try {
        img.src = live[i].toDataURL("image/png");
      } catch {}
      c.replaceWith(img);
    });
    clone.querySelectorAll("script, noscript, link, style, iframe").forEach((n) => n.remove());
    const cs = getComputedStyle(document.body);
    return {
      html: clone.innerHTML,
      bodyClass: document.body.className,
      bodyStyle: `font-family:${cs.fontFamily};font-size:${cs.fontSize};line-height:${cs.lineHeight};color:${cs.color};background:${cs.backgroundColor};`,
    };
  });

  // Avatars and other remote images become local files.
  let out = html;
  const remote = [...new Set([...out.matchAll(/src="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))];
  for (const url of remote) {
    const u = new URL(url.replaceAll("&amp;", "&"));
    const seed = u.searchParams.get("seed");
    const name2 = seed ? `${slug(seed)}.svg` : slug(u.pathname) + path.extname(u.pathname);
    const file = path.join(ROOT, "assets/avatars", name2);
    if (!existsSync(file)) {
      const res = await page.request.get(u.toString());
      if (!res.ok()) throw new Error(`image ${u} -> ${res.status()}`);
      writeFileSync(file, await res.body());
    }
    out = out.replaceAll(`src="${url}"`, `src="assets/avatars/${name2}"`);
  }
  out = out.replace(/ loading="lazy"/g, "");

  const file = path.join(dir, `${name}.html`);
  writeFileSync(file, `<div class="appbody ${bodyClass}" style="${bodyStyle}">${out}</div>\n`);
  return file;
}

/**
 * Mounts a snapshot inside an app-window-sized box on a 1920x1080 page, the
 * way the film does, and compares it with the live screenshot. Returns the
 * share of pixels that differ.
 */
export async function verify(mode, name) {
  const { width, height } = SIZES[mode];
  const dir = path.join(ROOT, "snap", mode);
  const fragment = readFileSync(path.join(dir, `${name}.html`), "utf8");
  const test = path.join(ROOT, `.verify-${mode}-${name}.html`);
  writeFileSync(
    test,
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="assets/app.${mode}.css">
<style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#888}
.appwin{position:absolute;left:40px;top:40px;width:${width}px;height:${height}px;overflow:hidden;contain:layout;--app-w:${width}px;--app-h:${height}px}
.appbody{position:absolute;inset:0}</style>
<div class="appwin">${fragment}</div>
<script>for (const el of document.querySelectorAll("[data-st]")) el.scrollTop = +el.dataset.st;</script>`,
  );
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`file://${test}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(dir, `${name}.embed.png`),
    clip: { x: 40, y: 40, width, height },
  });
  const b64 = (f) => `data:image/png;base64,${readFileSync(path.join(dir, f)).toString("base64")}`;
  const diff = await page.evaluate(
    async ([a, b, w, h]) => {
      const load = (src) =>
        new Promise((ok) => {
          const i = new Image();
          i.onload = () => ok(i);
          i.src = src;
        });
      const px = async (src) => {
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext("2d");
        g.drawImage(await load(src), 0, 0);
        return g.getImageData(0, 0, w, h).data;
      };
      const [A, B] = [await px(a), await px(b)];
      let n = 0;
      for (let i = 0; i < A.length; i += 4)
        if (
          Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) >
          24
        )
          n++;
      return n / (w * h);
    },
    [b64(`${name}.png`), b64(`${name}.embed.png`), width, height],
  );
  await browser.close();
  rmSync(test);
  return diff;
}
