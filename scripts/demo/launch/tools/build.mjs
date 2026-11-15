// Assembles the film from its sources:
//   src/scenes/<id>.html      a scene: <style>, markup, <script>
//   snap/<mode>/<name>.html   real app states (tools/snaplib.mjs)
//   src/cuts.mjs              which scenes each cut plays, and for how long
// and writes what HyperFrames renders:
//   compositions/<id>.html    one sub-composition per scene
//   index.html                the 16:9 film
//   vertical.html             the 9:16 cut
//   teaser.html               the 15-second cut
//
//   node tools/build.mjs
//
// In a scene, <div class="appwin" data-snap="desktop/side-researcher"> is
// filled with that app state. data-fix="name:arg; name2" then runs the named
// edits from src/fixes.mjs on it (swap in a sidebar, mark a row read).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { CUTS } from "../src/cuts.mjs";
import * as fixes from "../src/fixes.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const FILM_SIZE = { h: { w: 1920, h: 1080 }, v: { w: 1080, h: 1920 } };

const dom = new JSDOM("<!doctype html><body></body>");
const doc = dom.window.document;

/** A snapshot's markup as an element, ready to edit. */
export function loadSnap(name) {
  const file = `snap/${name}.html`;
  if (!existsSync(path.join(ROOT, file))) throw new Error(`missing snapshot ${file}`);
  const box = doc.createElement("div");
  box.innerHTML = read(file);
  return box.firstElementChild;
}

let uid = 0;
/** Ids from the app would collide across scenes: keep only the ones markup refers to. */
function scopeIds(el, scope) {
  const html = el.innerHTML;
  const used = new Set(
    [...html.matchAll(/url\(["']?#([^"')]+)["']?\)/g), ...html.matchAll(/href="#([^"]+)"/g)].map(
      (m) => m[1],
    ),
  );
  const n = uid++;
  for (const node of el.querySelectorAll("[id]")) {
    if (used.has(node.id)) node.id = `${scope}-${n}-${node.id}`;
    else node.removeAttribute("id");
  }
  for (const node of el.querySelectorAll("*")) {
    for (const a of [
      "for",
      "aria-labelledby",
      "aria-describedby",
      "aria-controls",
      "aria-owns",
      "aria-activedescendant",
    ])
      node.removeAttribute(a);
    for (const a of [
      "href",
      "xlink:href",
      "style",
      "fill",
      "stroke",
      "clip-path",
      "mask",
      "filter",
    ]) {
      const v = node.getAttribute(a);
      if (!v || !v.includes("#")) continue;
      node.setAttribute(
        a,
        v
          .replace(/url\((["']?)#([^"')]+)\1\)/g, (m, q, id) =>
            used.has(id) ? `url(#${scope}-${n}-${id})` : m,
          )
          .replace(/^#(.+)$/, (m, id) => (used.has(id) ? `#${scope}-${n}-${id}` : m)),
      );
    }
    // Links must not navigate if someone clicks in the preview.
    if (node.tagName === "A") node.removeAttribute("href");
  }
}

function buildScene(file, id, fmt) {
  const src = read(file);
  const dur = Number(/<!--\s*scene:\s*dur=([\d.]+)\s*-->/.exec(src)?.[1]);
  if (!dur) throw new Error(`${file}: missing <!-- scene: dur=N -->`);
  const style = /<style>([\s\S]*?)<\/style>/.exec(src)?.[1] ?? "";
  const script = /<script>([\s\S]*)<\/script>/.exec(src)?.[1] ?? "";
  const body = src
    .replace(/<!--\s*scene:[^>]*-->/, "")
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<script>[\s\S]*<\/script>/, "");

  const box = doc.createElement("div");
  box.innerHTML = body;
  for (const win of box.querySelectorAll("[data-snap]")) {
    const snap = loadSnap(win.getAttribute("data-snap"));
    win.removeAttribute("data-snap");
    win.appendChild(snap);
    for (const call of (win.getAttribute("data-fix") ?? "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const [name, ...args] = call.split(":").map((s) => s.trim());
      if (!fixes[name]) throw new Error(`${file}: unknown fix "${name}"`);
      fixes[name](win, { loadSnap, doc, args });
    }
    win.removeAttribute("data-fix");
    scopeIds(win, id);
  }

  const { w, h } = FILM_SIZE[fmt];
  const out = `<template>
  <style>
    #root {
      position: absolute;
      inset: 0;
    }
${style}
  </style>
  <div id="root" data-composition-id="${id}" data-width="${w}" data-height="${h}">
${box.innerHTML}
  </div>
  <script>
${script.replaceAll("{{id}}", id).replaceAll("{{dur}}", String(dur))}
  </script>
</template>
`;
  writeFileSync(path.join(ROOT, "compositions", `${id}.html`), out);
  return dur;
}

function buildCut(name, cut, durs) {
  const { w, h } = FILM_SIZE[cut.fmt];
  let t = 0;
  const hosts = cut.scenes.map(([id, slot, a, b], i) => {
    const d = slot ?? durs[id];
    const trim = a != null ? ` data-film-in="${a}" data-film-out="${b}"` : "";
    const host = `      <div
        id="${id}"
        data-composition-id="${id}"
        data-composition-src="compositions/${id}.html"
        data-start="${+t.toFixed(3)}"
        data-duration="${d}"
        data-track-index="1"
        data-track-kind="graphics"
        data-width="${w}"
        data-height="${h}"${trim}
        style="z-index: ${i + 1}"
      ></div>`;
    t += d;
    return host;
  });
  const total = +t.toFixed(3);
  const audio = ["music", "sfx"]
    .filter((kind) => existsSync(path.join(ROOT, `assets/audio/${kind}.${name}.wav`)))
    .map(
      (kind, i) => `      <audio
        id="${kind}"
        class="clip"
        src="assets/audio/${kind}.${name}.wav"
        data-start="0"
        data-duration="${total}"
        data-track-index="${i + 2}"
        data-volume="1"
      ></audio>`,
    );
  const html = `<!doctype html>
<!-- Generated by tools/build.mjs from src/cuts.mjs. Edit those, not this file. -->
<html lang="en" data-fmt="${cut.fmt}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${w}, height=${h}" />
    <title>tiny-agents: ${cut.title}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <link rel="stylesheet" href="assets/app.${cut.fmt === "h" ? "desktop" : "mobile"}.css" />
    <link rel="stylesheet" href="lib/film.css" />
    <script src="lib/film.js"></script>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${w}" data-height="${h}">
${hosts.join("\n")}
${audio.join("\n")}
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
  writeFileSync(path.join(ROOT, `${name}.html`), html);
  return total;
}

rmSync(path.join(ROOT, "compositions"), { recursive: true, force: true });
mkdirSync(path.join(ROOT, "compositions"), { recursive: true });
const durs = {};
const want = new Set(Object.values(CUTS).flatMap((c) => c.scenes.map((s) => s[0])));
for (const [dir, fmt] of [
  ["src/scenes", "h"],
  ["src/scenes/v", "v"],
]) {
  if (!existsSync(path.join(ROOT, dir))) continue;
  for (const f of readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith(".html"))
    .sort()) {
    const id = path.basename(f, ".html");
    if (!want.has(id)) continue;
    durs[id] = buildScene(`${dir}/${f}`, id, fmt);
  }
}
for (const [name, cut] of Object.entries(CUTS)) {
  const missing = cut.scenes.filter(([id]) => !(id in durs)).map(([id]) => id);
  if (missing.length) {
    console.log(`${name}.html: skipped, no source yet for ${missing.join(", ")}`);
    continue;
  }
  console.log(`${name}.html: ${buildCut(name, cut, durs)} s, ${cut.scenes.length} scenes`);
}
