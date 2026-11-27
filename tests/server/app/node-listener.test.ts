import http from "node:http";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { nodeRequestListener } from "../../../apps/web/src/server/node-listener";

let server: http.Server | undefined;

afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined));
  server = undefined;
});

async function serve(app: Hono): Promise<string> {
  server = http.createServer(nodeRequestListener(app.fetch));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("nodeRequestListener", () => {
  it("leaves the global Response alone, so a fetch result is still a Response", async () => {
    nodeRequestListener(new Hono().fetch);
    const answer = await fetch("data:text/plain,ok");
    expect(answer instanceof Response).toBe(true);
    expect(await answer.text()).toBe("ok");
  });

  it("serves a DELETE with no body through the body limit", async () => {
    const app = new Hono();
    app.use(bodyLimit({ maxSize: 1024 }));
    app.delete("/things/:id", (c) => c.json({ deleted: c.req.param("id") }));
    const base = await serve(app);
    const answer = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = http.request(`${base}/things/7`, { method: "DELETE" }, (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode!, body }));
      });
      request.on("error", reject);
      request.end();
    });
    expect(answer).toEqual({ status: 200, body: '{"deleted":"7"}' });
  });
});
