// Renders ../../android/lockscreen.html to lockscreen.png (412x892 CSS px at 3x, the chat
// stills' size) and writes where the notification is to lockscreen-positions.json.
//   node scripts/demo/launch/tools/android/preview-lockscreen.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../android");
const SCALE = 3;
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 412, height: 892 },
  deviceScaleFactor: SCALE,
});
const requests = [];
page.on("request", (r) => requests.push(r.url()));
await page.goto(pathToFileURL(resolve(out, "lockscreen.html")).href);
await page.screenshot({ path: resolve(out, "lockscreen.png") });

const rects = await page.evaluate(() => {
  const ids = {
    notification: "push-notification",
    title: "push-title",
    message: "push-message",
    app: "push-app",
    clock: "lock-clock",
  };
  const found = {};
  for (const [key, id] of Object.entries(ids)) {
    const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
    found[key] = { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  return found;
});
const round = (n) => Math.round(n * 10) / 10;
const positions = { scale: SCALE };
for (const [key, r] of Object.entries(rects)) {
  positions[key] = {
    css: { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) },
    px: {
      x: Math.round(r.x * SCALE),
      y: Math.round(r.y * SCALE),
      w: Math.round(r.w * SCALE),
      h: Math.round(r.h * SCALE),
    },
  };
}
writeFileSync(resolve(out, "lockscreen-positions.json"), JSON.stringify(positions, null, 2) + "\n");
const external = requests.filter((u) => !u.startsWith("file:"));
console.log(JSON.stringify(positions, null, 2));
console.log(external.length ? `EXTERNAL REQUESTS: ${external.join(", ")}` : "no external requests");
await browser.close();
