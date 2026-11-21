import { expect, it } from "vite-plus/test";

it("leaves a timer due", () => {
  const timer = setTimeout(() => {}, 60_000);
  expect(timer).toBeDefined();
});
