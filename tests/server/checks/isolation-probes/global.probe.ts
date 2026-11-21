import { expect, it } from "vite-plus/test";

it("adds a global directly", () => {
  (globalThis as Record<string, unknown>).isolationProbeLeak = true;
  expect(Reflect.has(globalThis, "isolationProbeLeak")).toBe(true);
});
