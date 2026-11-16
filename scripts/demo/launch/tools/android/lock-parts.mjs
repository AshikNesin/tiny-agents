// Splits the lock screen into the two layers the film animates:
//   android/lock-empty.png  the lock screen with no notification
//   android/lock-notif.png  the notification alone, on a transparent ground
// Both at 3x, like the chat stills.
//   node scripts/demo/launch/tools/android/lock-parts.mjs
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../android");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 3 });
await page.goto(pathToFileURL(resolve(out, "lockscreen.html")).href);
const notif = page.locator('[data-testid="push-notification"]');
const box = await notif.boundingBox();
await notif.evaluate((el) => (el.style.visibility = "hidden"));
await page.screenshot({ path: resolve(out, "lock-empty.png") });
await notif.evaluate((el) => {
  el.style.visibility = "visible";
  for (const other of document.body.querySelectorAll("*"))
    if (!el.contains(other) && !other.contains(el)) other.style.visibility = "hidden";
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  for (let p = el.parentElement; p; p = p.parentElement) p.style.background = "transparent";
});
const pad = 24;
await page.screenshot({
  path: resolve(out, "lock-notif.png"),
  omitBackground: true,
  clip: {
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  },
});
console.log(JSON.stringify({ notif: box, pad }));
await browser.close();
