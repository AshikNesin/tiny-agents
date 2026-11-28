import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const playwrightInstead = (error) => {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  return require("playwright");
};
const { chromium } = await import("playwright-core").catch(playwrightInstead);

const FPS = Number(process.env.FPS ?? 60);
const OUT = process.env.FRAMES_DIR ?? "tmp/demo/teaser-frames";
const STILLS = process.env.STILLS?.split(",").map(Number);
const FROM = Number(process.env.FROM ?? 0);
const html = fileURLToPath(new URL("./teaser.html", import.meta.url));

if (!STILLS && !FROM) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const WORKERS = Number(process.env.WORKERS ?? 4);
const browsers = [];
async function openPage() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--font-render-hinting=none", "--force-color-profile=srgb"],
  });
  browsers.push(browser);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`file://${html}`);
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const pages = await Promise.all(Array.from({ length: WORKERS }, openPage));
const end = await pages[0].evaluate(() => window.END);

const times = STILLS ?? Array.from({ length: Math.round(end * FPS) }, (_, i) => i / FPS);
const started = Date.now();
let done = 0;
await Promise.all(
  pages.map(async (page, w) => {
    const first = STILLS ? 0 : Math.floor(FROM * FPS);
    for (let i = first + w; i < times.length; i += WORKERS) {
      const t = times[i];
      await page.evaluate((t) => window.render(t), t);
      const name = STILLS ? `still-${t.toFixed(2)}.png` : `f${String(i).padStart(5, "0")}.png`;
      await page.screenshot({ path: `${OUT}/${name}`, type: "png" });
      if (++done % 120 === 0) {
        const rate = done / ((Date.now() - started) / 1000);
        console.log(`frame ${done}/${times.length} (${rate.toFixed(1)} fps)`);
      }
    }
  }),
);
console.log(`rendered ${done} frame(s) into ${OUT}`);
await Promise.all(browsers.map((b) => b.close()));
