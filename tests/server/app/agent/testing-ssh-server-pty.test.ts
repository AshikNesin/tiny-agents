import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import {
  fakePty,
  startFakeSandboxServer,
  Ssh2Client,
  type ClientChannel,
  type ExecOptions,
  type FakePty,
  type FakeSandboxServer,
  type PtyHandler,
} from "../../../../packages/sandbox/src/testing-ssh-server";

type TestClient = InstanceType<typeof Ssh2Client>;

function connect(port: number): Promise<TestClient> {
  const client = new Ssh2Client();
  return new Promise((resolve, reject) => {
    client
      .once("ready", () => resolve(client))
      .once("error", reject)
      .connect({ host: "127.0.0.1", port, username: "exedev" });
  });
}

function exec(
  client: TestClient,
  command: string,
  options: ExecOptions = {},
): Promise<ClientChannel> {
  return new Promise((resolve, reject) =>
    client.exec(command, options, (error, channel) => (error ? reject(error) : resolve(channel))),
  );
}

describe("in-process SSH server pty channels (integration, real ssh2 client)", () => {
  let ptyServer: FakeSandboxServer;
  let noPtyServer: FakeSandboxServer;
  let client: TestClient;
  let fake: FakePty | undefined;
  const ptyHandler: PtyHandler = (command, info) => {
    fake = fakePty(command, info);
    return fake;
  };

  beforeAll(async () => {
    ptyServer = await startFakeSandboxServer(
      (command) => (command.startsWith("echo ") ? { stdout: command.slice(5) } : { stdout: "" }),
      ptyHandler,
    );
    noPtyServer = await startFakeSandboxServer();
    client = await connect(ptyServer.port);
  });

  afterAll(() => {
    client?.end();
    ptyServer?.close();
    noPtyServer?.close();
  });

  it("routes a non-pty exec through the canned handler when a pty handler is installed", async () => {
    const channel = await exec(client, "echo plain exec");
    const stdout: Buffer[] = [];
    channel.on("data", (b: Buffer) => stdout.push(b));
    await vi.waitFor(() => expect(Buffer.concat(stdout).toString()).toBe("plain exec"));
    expect(ptyServer.execCalls).toContain("echo plain exec");
  });

  it("attaches an interactive pty: geometry reaches the handler, bytes flow both ways, channel stays open", async () => {
    const channel = await exec(client, "tmux attach-session -d -t ta-term-1", {
      pty: { term: "xterm-256color", cols: 100, rows: 30 },
    });
    expect(fake).toBeDefined();
    const f = fake!;
    expect(f.command).toBe("tmux attach-session -d -t ta-term-1");
    expect(f.term).toBe("xterm-256color");
    expect(f.cols).toBe(100);
    expect(f.rows).toBe(30);

    const received: Buffer[] = [];
    channel.on("data", (b: Buffer) => received.push(b));
    channel.write("stty size\n");
    await vi.waitFor(() => expect(f.written.map((b) => b.toString())).toEqual(["stty size\n"]));
    f.emit("30 / 100\r\n");
    await vi.waitFor(() => expect(Buffer.concat(received).toString()).toBe("30 / 100\r\n"));
    expect(channel.readable).toBe(true);
    expect(channel.writable).toBe(true);
  });

  it("carries client resizes to the pty (window-change)", async () => {
    const channel = await exec(client, "tmux attach-session -d -t ta-term-2", {
      pty: { term: "xterm-256color", cols: 100, rows: 30 },
    });
    const f = fake!;
    channel.setWindow(40, 120, 480, 640);
    await vi.waitFor(() => expect(f.resizes).toEqual([{ cols: 120, rows: 40 }]));
    expect(f.cols).toBe(120);
    expect(f.rows).toBe(40);
    f.setWindow(200, 50);
    expect(f.cols).toBe(200);
    expect(f.rows).toBe(50);
    expect(f.resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it("closes the client channel when the pty ends", async () => {
    const channel = await exec(client, "tmux attach-session -d -t ta-term-3", {
      pty: { term: "xterm-256color", cols: 80, rows: 24 },
    });
    channel.on("data", () => {});
    const closed = new Promise<void>((resolve) => channel.once("close", () => resolve()));
    fake!.end();
    await closed;
    expect(channel.readable).toBe(false);
  });

  it("rejects a pty exec on a server without a pty handler", async () => {
    const strict = await connect(noPtyServer.port);
    try {
      const error = await exec(strict, "tmux attach-session -d -t ta-term-1", { pty: true }).then(
        () => null,
        (e: Error) => e,
      );
      expect(error?.message).toMatch(/pseudo-terminal/i);
    } finally {
      strict.end();
    }
  });
});
