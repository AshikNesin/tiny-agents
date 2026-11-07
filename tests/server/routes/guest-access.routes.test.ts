import { describe, expect, it } from "vite-plus/test";
import { matchGuestRoute } from "../../../apps/web/src/server/api/people/guest.guard";
import { GUEST_ACCESS } from "../../../apps/web/src/shared/guest-access";
import { createTestApp } from "../helpers";

const TABLE = "GUEST_ACCESS (apps/web/src/shared/guest-access.ts)";
const API = "/api/v1";
const BOT = "/bots/1";

const fillPathParams = (pattern: string) => pattern.replace(/:[^/]+/g, "1").replace(/\*/g, "x");

const mounted = createTestApp()
  .routes.filter((route) => route.method !== "ALL" && route.path.startsWith(`${API}/`))
  .map((route) => ({ method: route.method, path: fillPathParams(route.path.slice(API.length)) }));

const isBotPath = (path: string) => path === BOT || path.startsWith(`${BOT}/`);

const rules = Object.entries(GUEST_ACCESS).flatMap(([name, feature]) =>
  feature.api.map((rule) => ({
    label: `${name}: ${"bot" in rule ? `bot ${rule.bot}` : `path ${rule.path}`}`,
    rule,
  })),
);

const ruleAllows = ({ rule }: (typeof rules)[number], method: string, path: string) =>
  (rule.methods === "*" || rule.methods.includes(method)) &&
  ("bot" in rule ? isBotPath(path) && rule.bot.test(path.slice(BOT.length)) : rule.path.test(path));

describe("guest access table", () => {
  it("lets the guard admit a guest to exactly the routes the table lists", () => {
    expect(mounted.length).toBeGreaterThan(50);
    for (const { method, path } of mounted) {
      const admitted = matchGuestRoute(method, path);
      expect(
        admitted !== undefined,
        `The guest guard and ${TABLE} disagree on ${method} ${path}. Grant guest access only through ${TABLE}.`,
      ).toBe(rules.some((rule) => ruleAllows(rule, method, path)));
      if (admitted && isBotPath(path)) {
        expect(admitted.botId, `${method} ${path} must check the bot is shared`).toBe("1");
      }
    }
  });

  it("matches a mounted route with every rule in the table", () => {
    for (const rule of rules) {
      const served = mounted.some(({ method, path }) => ruleAllows(rule, method, path));
      expect(served, `${TABLE} ${rule.label} matches no route the server mounts.`).toBe(true);
    }
  });

  it("reaches a bot's routes only through bot rules, which check the bot is shared", () => {
    for (const rule of rules) {
      if ("bot" in rule.rule) continue;
      for (const { path } of mounted.filter((route) => isBotPath(route.path))) {
        expect(
          rule.rule.path.test(path),
          `${TABLE} ${rule.label} matches ${path}. Write it as a \`bot\` rule (matched after /bots/<id>), so the guard checks the bot is shared with the guest.`,
        ).toBe(false);
      }
    }
  });
});
