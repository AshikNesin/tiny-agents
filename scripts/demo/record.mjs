// Demo-only recorder: drives the app inside the stage page and captures
// 1920x1080 frames over a CDP screencast (frames + timestamps for encode.py).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const OUT = process.env.FRAMES_DIR ?? "tmp/demo/frames";
const ONLY = process.env.SCENES?.split(",");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await context.request.post(`${BASE}/api/v1/auth/login`, {
  data: { email: "demo@example.com", password: "demo@example.com" }, // gitleaks:allow seeded demo login
});
const bots = (await (await context.request.get(`${BASE}/api/v1/bots`)).json()).data;
const botId = (name) => bots.find((b) => b.name === name).id;

const page = await context.newPage();
const stageHtml = readFileSync(new URL("./stage.html", import.meta.url), "utf8");
await page.route(`${BASE}/__stage`, (route) =>
  route.fulfill({ contentType: "text/html", body: stageHtml }),
);
await page.goto(`${BASE}/__stage`);
const app = page.frameLocator("#app");
const stage = (fn, ...args) => page.evaluate(([f, a]) => window.stage[f](...a), [fn, args]);

// ── Capture ──────────────────────────────────────────────────────────────
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  const file = `f${String(frames.length).padStart(6, "0")}.jpg`;
  writeFileSync(`${OUT}/${file}`, Buffer.from(data, "base64"));
  frames.push({ file, t: metadata.timestamp });
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
});

// ── Cursor & input ───────────────────────────────────────────────────────
// Page coordinates (1920x1080); the cursor rests over the app's empty right side.
const REST = { x: 1660, y: 900 };
let cur = { x: 1800, y: 1040 };
async function moveTo(x, y, ms = 700) {
  const from = { ...cur };
  const started = Date.now();
  // Time-based, so a move takes `ms` however slow each CDP round-trip is.
  for (;;) {
    const t = Math.min(1, (Date.now() - started) / ms);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    // A slight arc reads as a hand, not a robot.
    const arc = Math.sin(Math.PI * t) * Math.min(40, Math.hypot(x - from.x, y - from.y) * 0.08);
    const px = from.x + (x - from.x) * e;
    const py = from.y + (y - from.y) * e - arc;
    await Promise.all([page.mouse.move(px, py), stage("cursor", px, py)]);
    if (t >= 1) break;
    await sleep(6);
  }
  cur = { x, y };
}
async function center(locator) {
  await locator.waitFor({ state: "visible", timeout: 30_000 });
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}
async function hover(locator, ms) {
  const c = await center(locator);
  await moveTo(c.x, c.y, ms);
}
async function click(locator, { ms = 700, dx = 0 } = {}) {
  const c = await center(locator);
  await moveTo(c.x + dx, c.y, ms);
  await sleep(110);
  await stage("ripple", c.x + dx, c.y);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(160);
}
async function type(text, [min, max] = [28, 70]) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(ch === " " ? rand(min, max * 1.3) : rand(min, max));
  }
}
async function palette(query) {
  // Keys go to the app, whichever document had focus.
  await app.locator("html").evaluate(() => window.focus());
  await page.keyboard.press("Control+k");
  const input = app.getByPlaceholder("Type a command or search...");
  await input.waitFor();
  await sleep(250);
  await type(query, [40, 75]);
  await sleep(350);
  await page.keyboard.press("Enter");
  await sleep(400);
}
// Stretches spent watching a bot stream play back faster in the edit.
const speedups = [];
async function fast(factor, fn) {
  const from = Date.now() / 1000;
  try {
    return await fn();
  } finally {
    speedups.push({ from, to: Date.now() / 1000, factor });
  }
}
const composer = (name) => app.getByPlaceholder(new RegExp(`^Message ${name}`));

// ── Scenes ───────────────────────────────────────────────────────────────
const scenes = {
  async intro() {
    await stage("cardIn", "Your team of always-on AI bots", []);
    await sleep(2400);
    await stage("cardOut");
    await sleep(650);
  },

  async team() {
    await stage("caption", "Meet your team", "Every contact is an AI bot");
    await sleep(250);
    await hover(app.getByRole("link", { name: /Chief of Staff/ }).first(), 700);
    await sleep(150);
    await hover(app.getByRole("link", { name: /Researcher/ }).first(), 300);
    await sleep(120);
    await hover(app.getByRole("link", { name: /Code Buddy/ }).first(), 330);
    await sleep(120);
    await hover(app.getByRole("link", { name: /Writer/ }).first(), 330);
    await sleep(250);
  },

  async create() {
    await stage("caption", "New bot", "Persona, model and tools in seconds");
    await click(app.getByRole("button", { name: "New bot" }), { ms: 500 });
    const dialog = app.getByRole("dialog");
    await dialog.waitFor();
    await sleep(200);
    await click(dialog.getByLabel("Name", { exact: true }), { ms: 420 });
    await type("Travel Planner", [16, 36]);
    await click(dialog.getByLabel("Description"), { ms: 330 });
    await type("Plans trips around how you travel", [7, 18]);
    await click(dialog.getByRole("button", { name: "Claude Sonnet 5.5" }), { ms: 380 });
    await sleep(220);
    await click(app.getByRole("menuitem", { name: /^GPT-5\.4/ }), { ms: 330 });
    await click(dialog.getByLabel("System prompt"), { ms: 330 });
    await type("Plan relaxed, food-first trips. Ask before you assume.", [5, 14]);
    await sleep(150);
    await click(dialog.getByRole("button", { name: /create bot/i }), { ms: 420 });
    await composer("Travel Planner").waitFor({ timeout: 15_000 });
    await sleep(350);
  },

  async questions() {
    await stage("caption", "Human in the loop", "Bots ask before they guess");
    await click(composer("Travel Planner"), { ms: 420 });
    await type("Plan a weekend in Bangalore for me", [12, 28]);
    await page.keyboard.press("Enter");
    const card = app.getByTestId("question-card");
    await fast(3, () => card.waitFor({ timeout: 30_000 }));
    await sleep(350);
    const c = await center(card);
    await stage("caption", null);
    await stage("zoom", c.x, c.b.y + 40, 1.32);
    await sleep(950);
    await click(card.getByText("Food & cafés"), { ms: 450 });
    await sleep(150);
    await click(card.getByRole("button", { name: "Next" }), { ms: 420 });
    await sleep(300);
    await click(card.getByText("Great food"), { ms: 420 });
    await click(card.getByText("Early mornings"), { ms: 320 });
    await sleep(150);
    await click(card.getByRole("button", { name: "Next" }), { ms: 420 });
    await sleep(300);
    await click(card.getByText("₹4,000–8,000"), { ms: 420 });
    await sleep(150);
    await click(card.getByRole("button", { name: "Send answers" }), { ms: 420 });
    await sleep(250);
    await stage("zoom", c.x, c.y, 1);
    await stage("caption", "Human in the loop", "…then carry on with your answers");
    await moveTo(REST.x, REST.y, 600);
    await fast(2.5, () => app.getByText(/Indiranagar: walkable/).waitFor({ timeout: 40_000 }));
    await sleep(900);
  },

  async browse() {
    await stage("caption", "Research", "Searches the web, then browses it live");
    await click(app.getByRole("link", { name: /Researcher/ }).first(), { ms: 450 });
    await sleep(250);
    await click(composer("Researcher"), { ms: 400 });
    await type("Find me a Friday evening flight from Chennai to Bangalore", [10, 24]);
    await page.keyboard.press("Enter");
    await moveTo(REST.x, REST.y, 600);
    await fast(2.5, () => app.getByTestId("browser-panel").waitFor({ timeout: 30_000 }));
    await stage("caption", "Its own browser", "Watch it browse live, or take the wheel");
    await app
      .getByText(/Best Friday-evening pick|Here are Friday's flights/)
      .waitFor({ timeout: 60_000 });
    // The panel's status line polls every 4 s; let it catch up with the page.
    await fast(2, () =>
      app
        .getByTestId("browser-url")
        .filter({ hasText: /google/ })
        .waitFor({ timeout: 10_000 }),
    );
    await sleep(300);
    await hover(app.getByTestId("browser-takeover"), 650);
    await sleep(1100);
  },

  async computer() {
    await stage("caption", "Its own computer", "Bots run real commands on a sandbox VM");
    await click(app.getByRole("link", { name: /Code Buddy/ }).first(), { ms: 450 });
    await sleep(250);
    await click(composer("Code Buddy"), { ms: 400 });
    await type("Run the tests in acme-shop", [14, 30]);
    await page.keyboard.press("Enter");
    await moveTo(REST.x, REST.y, 600);
    await fast(2.5, () => app.getByText(/Want me to add one/).waitFor({ timeout: 40_000 }));
    await sleep(300);
    await click(app.getByText("Ran a command").first(), { ms: 500 });
    await sleep(1700);
  },

  async terminal() {
    await stage("caption", "Terminal", "A real shell on that machine, right in the app");
    await click(app.getByRole("link", { name: /^Terminal/ }).first(), { ms: 500 });
    const create = app.getByTestId("terminal-create");
    const xterm = app.locator(".xterm").filter({ visible: true }).first();
    await Promise.race([create.waitFor({ timeout: 20_000 }), xterm.waitFor({ timeout: 20_000 })]);
    if (await create.isVisible()) await click(create, { ms: 450 });
    await xterm.waitFor({ timeout: 20_000 });
    // A fresh tab attaches over SSH + tmux; let the shell's prompt arrive first.
    await sleep(2200);
    await click(xterm, { ms: 400 });
    await page.keyboard.press("Control+l");
    await sleep(300);
    const t = await center(xterm);
    await stage("caption", null);
    await stage("zoom", t.b.x + t.b.width * 0.22, t.b.y + 30, 1.35);
    await sleep(800);
    await type("cd acme-shop && npm test", [24, 50]);
    await page.keyboard.press("Enter");
    await sleep(2300);
    await stage("zoom", t.x, t.y, 1);
    await sleep(500);
  },

  async actions() {
    await stage("caption", "Routines", "Set up recurring work, straight from chat");
    await click(app.getByRole("link", { name: /Chief of Staff/ }).first(), { ms: 500 });
    await sleep(250);
    await click(composer("Chief of Staff"), { ms: 400 });
    await type("Every weekday at 9am, brief me on my day and Friday's flight fares", [7, 16]);
    await page.keyboard.press("Enter");
    await moveTo(REST.x, REST.y, 600);
    await fast(2.5, () => app.getByText(/first briefing lands/).waitFor({ timeout: 40_000 }));
    await sleep(1000);
  },

  async pages() {
    await stage("caption", "⌘K", "Jump anywhere");
    await palette("Routines");
    await stage("caption", "Routines", "Every schedule in one place, with its next run");
    await app.getByText("Morning briefing").first().waitFor();
    await hover(app.getByText("Morning briefing").first(), 500);
    await sleep(800);
    await palette("Memory");
    await stage("caption", "Memory", "What bots remember, yours to edit");
    await sleep(400);
    await moveTo(1056, 672, 450);
    await page.mouse.wheel(0, 260);
    await sleep(900);
    await palette("Skills");
    await stage("caption", "Skills", "Reusable playbooks for every bot");
    await sleep(1300);
  },

  async durable() {
    await stage("caption", "Durable", "Refresh mid-reply. It keeps going.");
    await palette("Writer");
    await sleep(250);
    await click(composer("Writer"), { ms: 400 });
    await type("Write a short launch announcement for tiny-agents", [10, 24]);
    await page.keyboard.press("Enter");
    await moveTo(REST.x, REST.y, 600);
    await fast(2, () => app.getByText(/Your own team of always-on/).waitFor({ timeout: 30_000 }));
    await sleep(900);
    await stage("toast", "⟳  Page refreshed mid-reply");
    await page.evaluate(() => document.getElementById("app").contentWindow.location.reload());
    await composer("Writer").waitFor({ timeout: 20_000 });
    await fast(1.4, () => app.getByText(/Your team is waiting/).waitFor({ timeout: 40_000 }));
    await sleep(900);
  },

  async style() {
    await stage("caption", "Your style", "Light or dark, desktop or phone");
    await palette("Light");
    await stage("light", true);
    await sleep(1100);
    await stage("cursorVisible", false);
    await stage("phone", true);
    await sleep(2400);
  },

  async outro() {
    await stage("caption", null);
    await stage("cardIn", "Your team of always-on AI bots", [
      "Durable conversations",
      "Browser & terminal",
      "Bots that ask first",
    ]);
    await sleep(3200);
  },
};

// Start in a lived-in chat, fully loaded before capture begins.
await page.evaluate(
  (src) => (document.getElementById("app").src = src),
  `${BASE}/chats/${botId("Fitness Coach")}`,
);
await app
  .getByRole("link", { name: /Fitness Coach/ })
  .first()
  .waitFor({ timeout: 30_000 });
await app.getByText(/no-equipment routine/).waitFor({ timeout: 30_000 });
// Warm the Researcher's browser (Xtigervnc + Chrome on the "VM") so the
// live view doesn't wait on a cold launch mid-scene.
await context.request.post(`${BASE}/api/v1/bots/${botId("Researcher")}/browser/start`);
for (let i = 0; i < 60; i++) {
  const status = await (
    await context.request.get(`${BASE}/api/v1/bots/${botId("Researcher")}/browser`)
  ).json();
  if (status.data?.phase === "active" || status.data?.active) break;
  await sleep(500);
}
// A fresh Chrome window focuses its address bar; one real click in the page
// moves focus there, so the bot's navigation doesn't leave the URL selected.
await sleep(1500);
const display = execSync(
  "ps -u exedev -o args= | grep -o 'Xtigervnc :[0-9]*' | head -1 | cut -d: -f2",
)
  .toString()
  .trim();
if (display) execSync(`su - exedev -c "DISPLAY=:${display} xdotool mousemove 500 450 click 1"`);
await page.mouse.move(cur.x, cur.y);
await stage("cursor", cur.x, cur.y);
await sleep(1500);

// Partial runs (SCENES=...) skip the intro, so its card must not cover the app.
if (ONLY && !ONLY.includes("intro")) await stage("cardOut");
await cdp.send("Page.startScreencast", {
  format: "jpeg",
  quality: 92,
  maxWidth: 1920,
  maxHeight: 1080,
  everyNthFrame: 1,
});
const marks = [];
const start = Date.now() / 1000;
for (const [name, scene] of Object.entries(scenes)) {
  if (ONLY && !ONLY.includes(name)) continue;
  marks.push({ name, t: Date.now() / 1000 });
  console.log(`scene ${name} @ ${(Date.now() / 1000 - start).toFixed(1)}s`);
  await scene();
}
const end = Date.now() / 1000;
await cdp.send("Page.stopScreencast");
await sleep(300);
writeFileSync(
  `${OUT}/frames.json`,
  JSON.stringify({ frames, marks, speedups, start, end }, null, 1),
);
console.log(`captured ${frames.length} frames over ${(end - start).toFixed(1)}s`);
await browser.close();
