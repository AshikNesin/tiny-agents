import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";
import { nodeRequestListener } from "../../../apps/web/src/server/node-listener";

describe("nodeRequestListener", () => {
  it("leaves the global Response alone, so a fetch result is still a Response", async () => {
    nodeRequestListener(new Hono().fetch);
    const answer = await fetch("data:text/plain,ok");
    expect(answer instanceof Response).toBe(true);
    expect(await answer.text()).toBe("ok");
  });
});
