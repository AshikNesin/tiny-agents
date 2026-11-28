import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { matchRoutes } from "react-router-dom";
import { describe, expect, it } from "vite-plus/test";
import { appRoutes } from "../../apps/web/src/client/App";

const ROOT = path.resolve(__dirname, "../..");
const SKILL = path.join(ROOT, ".agents/skills/verify-tiny-agents");

function filesIn(dir: string, ext: string) {
  return readdirSync(path.join(SKILL, dir))
    .filter((name) => name.endsWith(ext))
    .map((name) => ({ name, text: readFileSync(path.join(SKILL, dir, name), "utf8") }));
}

const journeys = filesIn("journeys", ".mjs");
const recipes = filesIn("features", ".md");

const concrete = (raw: string) => raw.replace(/\$\{[^}]*\}/g, "x").replace(/[?#].*$/, "");

const sectionIds = new Set(
  [
    ...readFileSync(
      path.join(ROOT, "apps/web/src/client/pages/settings/sections.ts"),
      "utf8",
    ).matchAll(/\bid: "([a-z-]+)"/g),
  ].map((m) => m[1]),
);

describe("verify journeys name real pages", () => {
  it("finds the settings sections to check against", () => {
    expect([...sectionIds]).toEqual(expect.arrayContaining(["account", "models", "security"]));
  });

  it("every page.goto() path matches an app route", () => {
    const unmatched: string[] = [];
    for (const { name, text } of journeys) {
      for (const [, raw] of text.matchAll(/\.goto\(\s*["'`](\/[^"'`]*)["'`]/g)) {
        const matches = matchRoutes(appRoutes, concrete(raw));
        const leaf = matches?.at(-1)?.route.path;
        if (!leaf || leaf === "*") unmatched.push(`${name}: ${raw}`);
      }
    }
    expect(unmatched).toEqual([]);
  });

  it("every /settings/<section> named is a real section", () => {
    const unknown: string[] = [];
    for (const { name, text } of [...journeys, ...recipes]) {
      for (const [, id] of text.matchAll(/\/settings\/([a-z-]+)/g)) {
        if (!sectionIds.has(id)) unknown.push(`${name}: /settings/${id}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("nothing uses the old /settings?tab= links", () => {
    const legacy = [...journeys, ...recipes]
      .filter(({ text }) => text.includes("/settings?tab="))
      .map(({ name }) => name);
    expect(legacy).toEqual([]);
  });
});
