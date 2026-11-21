import { expect, it } from "vite-plus/test";

it("sets an env var directly", () => {
  process.env.ISOLATION_PROBE_LEAK = "1";
  expect(process.env.ISOLATION_PROBE_LEAK).toBe("1");
});
