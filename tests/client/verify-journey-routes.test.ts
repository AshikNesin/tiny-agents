/**
 * The verify skill's journeys and feature recipes name app pages; when a page
 * moves they rot silently, because CI never drives them (issue #241: the
 * settings revamp left eleven journeys on `/settings?tab=…`). This keeps the
 * paths they name honest against the real route table:
 *
 * - every `page.goto("/…")` in a journey matches a route other than the
 *   catch-all redirect;
 * - every `/settings/<section>` a journey or recipe names is a real section;
 * - nobody drives the old `/settings?tab=` links except the probes that
 *   check they still redirect.
 */
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

/** A template literal's `${…}` parts become one path segment's worth of text. */
const concrete = (raw: string) => raw.replace(/\$\{[^}]*\}/g, "x").replace(/[?#].*$/, "");

/** The section ids `SettingsPage` mounts (owner and guest alike). */
const sectionIds = new Set(
  [
    ...readFileSync(
      path.join(ROOT, "apps/web/src/client/pages/settings/SettingsPage.tsx"),
      "utf8",
    ).matchAll(/\bid: "([a-z-]+)"/g),
  ].map((m) => m[1]),
);

/** Journeys and recipes that open an old `?tab=` link on purpose, to check it redirects. */
const LEGACY_TAB_PROBES = new Set(["account-shell.mjs", "account-shell.md"]);

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

  it("only the redirect probes use the old /settings?tab= links", () => {
    const legacy = [...journeys, ...recipes]
      .filter(({ name, text }) => !LEGACY_TAB_PROBES.has(name) && text.includes("/settings?tab="))
      .map(({ name }) => name);
    expect(legacy).toEqual([]);
  });
});
