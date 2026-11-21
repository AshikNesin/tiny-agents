import { describe, expect, it } from "vite-plus/test";
import { prePushPlan } from "../../../scripts/pre-push.mjs";

describe("the pre-push plan", () => {
  it("formats and lints only the pushed files, and typechecks when a program can change", () => {
    expect(
      prePushPlan(["apps/web/src/server/app.ts", "docs/guides/testing.md", "pnpm-lock.yaml"]),
    ).toEqual({
      fmt: ["apps/web/src/server/app.ts", "docs/guides/testing.md"],
      lint: ["apps/web/src/server/app.ts"],
      typecheck: true,
    });
  });

  it("skips the typecheck when no TypeScript file or config changed", () => {
    expect(prePushPlan(["docs/guides/testing.md", "scripts/gates.mjs"])).toEqual({
      fmt: ["docs/guides/testing.md", "scripts/gates.mjs"],
      lint: ["scripts/gates.mjs"],
      typecheck: false,
    });
    expect(prePushPlan(["apps/web/tsconfig.json"]).typecheck).toBe(true);
  });

  it("typechecks when a TypeScript file was deleted or renamed away, without formatting it", () => {
    expect(prePushPlan(["docs/old.md"], ["apps/web/src/server/gone.ts"])).toEqual({
      fmt: ["docs/old.md"],
      lint: [],
      typecheck: true,
    });
  });
});
