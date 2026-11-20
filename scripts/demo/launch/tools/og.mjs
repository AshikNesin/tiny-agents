import { createRequire } from "node:module";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.resolve(ROOT, "../../../site/media/og.png");
const snap = (name) => readFileSync(path.join(ROOT, "snap/desktop", `${name}.html`), "utf8");
if (!existsSync(path.join(ROOT, "assets/app.desktop.film.css")))
  execFileSync("node", [path.join(ROOT, "tools/build.mjs")], { stdio: "ignore" });

const page = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="assets/app.desktop.film.css">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #f6f6f7; }
  .og { position: absolute; inset: 0; font-family: "Inter Variable", Inter, sans-serif; color: #1f1f23;
        -webkit-font-smoothing: antialiased; font-feature-settings: "cv11", "ss01"; }
  .brand { position: absolute; left: 72px; top: 64px; display: flex; align-items: center; gap: 12px;
           font-size: 26px; font-weight: 650; letter-spacing: -0.02em; }
  .brand svg { width: 40px; height: 40px; display: block; }
  h1 { position: absolute; left: 72px; top: 178px; width: 560px; margin: 0; font-size: 60px; line-height: 1.04;
       font-weight: 700; letter-spacing: -0.045em; }
  h1 .soft { color: #8b8b94; }
  .sub { position: absolute; left: 72px; top: 400px; width: 470px; margin: 0; font-size: 23px; line-height: 1.4;
         color: #55555e; letter-spacing: -0.01em; }
  .shot { position: absolute; overflow: hidden; background: #fff; border-radius: 18px;
          box-shadow: 0 0 0 1px rgba(24,24,32,.08), 0 30px 70px -20px rgba(24,24,32,.28), 0 8px 22px -8px rgba(24,24,32,.12); }
  .cam { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .appwin { position: absolute; left: 0; top: 0; width: 1280px; height: 720px; --app-w: 1280px; --app-h: 720px;
            overflow: hidden; contain: layout; text-align: left; }
  .appwin > .appbody { position: absolute; inset: 0; }
  .appwin *, .appwin *::before, .appwin *::after { animation: none !important; transition: none !important; }
  .fbx { display: none !important; }
  .appwin [data-slot="message-scroller-item"] { content-visibility: visible; }
</style></head>
<body><div class="og">
  <div class="brand">
    <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1f1f23"/>
      <path fill="#fff" d="M23 14h16a12 12 0 0 1 12 12v6a12 12 0 0 1-12 12H29l-11 8v-9.09A12 12 0 0 1 11 32v-6a12 12 0 0 1 12-12z"/>
      <rect x="24" y="22" width="6" height="12" rx="3" fill="#1f1f23"/><rect x="36" y="22" width="6" height="12" rx="3" fill="#1f1f23"/>
      <circle cx="49.5" cy="15.5" r="5.5" fill="#fff" stroke="#1f1f23" stroke-width="3.5"/></svg>
    Tiny Agents
  </div>
  <h1>Your personal AI assistant. <span class="soft">On your own server.</span></h1>
  <p class="sub">A team of bots that code, browse and book for you, and ask before anything that matters.</p>
  <div class="shot list"><div class="cam"><div class="appwin">${snap("side-researcher")}</div></div></div>
  <div class="shot card"><div class="cam"><div class="appwin">${snap("travel-waiting")}</div></div></div>
</div></body></html>`;

const file = path.join(ROOT, ".og.html");
writeFileSync(file, page);
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await tab.goto(`file://${file}`);
await tab.evaluate(() => document.fonts.ready);
await tab.evaluate(() => {
  for (const el of document.querySelectorAll("[data-st]")) el.scrollTop = +el.dataset.st;
  const frame = (shot, target, { left, top, width, pad }) => {
    const cam = shot.querySelector(".cam");
    const r = target.getBoundingClientRect();
    const w = cam.firstElementChild.getBoundingClientRect();
    const box = {
      x: r.left - w.left - pad,
      y: r.top - w.top - pad,
      w: r.width + 2 * pad,
      h: r.height + 2 * pad,
    };
    const k = width / box.w;
    Object.assign(shot.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${box.h * k}px`,
    });
    cam.style.transform = `translate(${-box.x * k}px, ${-box.y * k}px) scale(${k})`;
  };
  const list = document.querySelector(".list");
  const bots = list.querySelector('section[aria-label="Bots"] ul');
  frame(list, bots, { left: 672, top: 44, width: 456, pad: 10 });
  const cardShot = document.querySelector(".card");
  const card = [...cardShot.querySelectorAll('[data-slot="item"]')].find((e) =>
    e.textContent.includes("wants to fill"),
  );
  for (const el of cardShot.querySelectorAll(".appwin *")) el.style.visibility = "hidden";
  for (const el of [card, ...card.querySelectorAll("*")]) el.style.visibility = "visible";
  frame(cardShot, card, { left: 612, top: 446, width: 480, pad: 0 });
  const k = 480 / card.getBoundingClientRect().width;
  cardShot.style.borderRadius = `${parseFloat(getComputedStyle(card).borderTopLeftRadius) * k}px`;
  cardShot.style.background = getComputedStyle(card).backgroundColor;
});
await tab.waitForTimeout(200);
await tab.screenshot({ path: OUT });
await browser.close();
rmSync(file);
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-i",
  OUT,
  "-vf",
  "scale=1200:630:flags=lanczos",
  OUT + ".tmp.png",
]);
execFileSync("mv", [OUT + ".tmp.png", OUT]);
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
