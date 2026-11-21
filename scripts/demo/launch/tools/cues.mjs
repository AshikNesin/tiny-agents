import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { CUTS, KIND } from "../src/cuts.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(import.meta.dirname, "..");
mkdirSync(path.join(ROOT, "assets/audio"), { recursive: true });

const browser = await chromium.launch();
for (const [name, cut] of Object.entries(CUTS)) {
  const dir = process.env.SCENE
    ? path.resolve(ROOT, process.env.FILM_OUT ?? ".film/index")
    : path.resolve(ROOT, process.env.FILM_OUT ?? ".film", name);
  const file = path.join(dir, "index.html");
  if (!existsSync(file)) continue;
  const size = cut.fmt === "h" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
  const page = await browser.newPage({ viewport: size });
  page.on("pageerror", (e) => console.error(`${name}: ${e.message}`));
  await page.addInitScript(() => (window.__timelines = {}));
  await page.goto(`file://${file}`);
  const scenes = Object.fromEntries(
    cut.scenes.map(([id]) => [
      id,
      readFileSync(path.join(dir, "compositions", `${id}.html`), "utf8"),
    ]),
  );
  await page.evaluate((scenes) => {
    for (const [id, html] of Object.entries(scenes)) {
      const tpl = document.createElement("div");
      tpl.innerHTML = html;
      const content = tpl.querySelector("template").content;
      const host = document.getElementById(id);
      const style = document.createElement("style");
      style.textContent = [...content.querySelectorAll("style")]
        .map((s) => s.textContent.replaceAll("#root", `#${id} > [data-hf-inner-root]`))
        .join("\n");
      document.head.appendChild(style);
      const inner = content.querySelector("#root");
      inner.removeAttribute("id");
      inner.setAttribute("data-hf-inner-root", "true");
      host.style.cssText += ";position:absolute;inset:0";
      host.appendChild(inner);
      for (const s of content.querySelectorAll("script")) new Function(s.textContent)();
    }
  }, scenes);
  await page.waitForFunction(
    (n) => Object.keys(window.__filmCues ?? {}).length === n,
    cut.scenes.length,
    { timeout: 30000 },
  );
  const got = await page.evaluate(() => window.__filmCues);
  await page.close();

  const cues = [];
  const sections = [];
  let length = 0;
  for (const [id] of cut.scenes) {
    const s = got[id];
    const rate = s.slot / (s.out - s.in);
    const at = (t) => +(s.start + (t - s.in) * rate).toFixed(3);
    sections.push({ t: s.start, kind: KIND[id.replace(/^v/, "s")] ?? "beat" });
    for (const c of s.list) {
      if (c.t < s.in - 1e-6 || c.t > s.out + 1e-6) continue;
      if (c.name.startsWith("section:")) sections.push({ t: at(c.t), kind: c.name.slice(8) });
      else cues.push({ ...c, t: at(c.t), ...(c.d ? { d: +(c.d * rate).toFixed(3) } : {}) });
    }
    length = Math.max(length, s.start + s.slot);
  }
  cues.sort((a, b) => a.t - b.t);
  const out = path.join(ROOT, `assets/audio/cues.${name}.json`);
  writeFileSync(out, JSON.stringify({ length, sections, cues }, null, 1));
  console.log(
    `${path.relative(ROOT, out)}: ${length} s, ${sections.length} sections, ${cues.length} cues`,
  );
}
await browser.close();
