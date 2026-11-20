import { createServer } from "node:net";
import { expect, it } from "vite-plus/test";

it("leaves a server listening", async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  expect(server.listening).toBe(true);
});
