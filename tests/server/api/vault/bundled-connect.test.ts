/**
 * The bundled 1Password Connect server (ADR 0027): pulling the pinned
 * binaries from a registry (a fake one here, the network boundary) and
 * running both processes with the bus wired over loopback (fake executables,
 * the subprocess boundary).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  ensureConnectBinary,
  type ImageSource,
} from "../../../../apps/web/src/server/api/vault/connect/connect-image";
import {
  sessionFromCredentials,
  startBundledConnect,
  type BundledConnect,
} from "../../../../apps/web/src/server/api/vault/connect/bundled-connect";
import { until } from "../../fixtures/until";

const digestOf = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "op-connect-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A gzipped layer holding `files` (path → contents), made by the system tar like an image build. */
async function layer(files: Record<string, string>): Promise<Uint8Array> {
  const root = path.join(dir, `layer-${Object.keys(files).join("-").replace(/\W/g, "")}`);
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), contents);
  }
  return gzipSync(execFileSync("tar", ["-cf", "-", "-C", root, "."]));
}

interface FakeRegistry {
  url: string;
  manifests: Map<string, Uint8Array>;
  blobs: Map<string, Uint8Array>;
  requests: string[];
  close(): Promise<void>;
}

/** The registry HTTP subset a pull uses: a bearer challenge, manifests by digest, blobs behind a redirect. */
async function startFakeRegistry(): Promise<FakeRegistry> {
  const state = {
    manifests: new Map<string, Uint8Array>(),
    blobs: new Map<string, Uint8Array>(),
    requests: [] as string[],
  };
  const app = new Hono();
  let base = "";
  app.get("/token", (c) => c.json({ token: `pull:${c.req.query("scope")}` }));
  app.get("/cdn/:digest", (c) => {
    const blob = state.blobs.get(c.req.param("digest"));
    return blob ? c.body(Buffer.from(blob)) : c.body(null, 404);
  });
  app.get("/v2/:ns/:repo/:kind/:digest", (c) => {
    const { ns, repo, kind, digest } = c.req.param();
    state.requests.push(`${kind}/${digest}`);
    if (c.req.header("authorization") !== `Bearer pull:repository:${ns}/${repo}:pull`) {
      c.header(
        "WWW-Authenticate",
        `Bearer realm="${base}/token",service="fake",scope="repository:${ns}/${repo}:pull"`,
      );
      return c.body(null, 401);
    }
    if (kind === "blobs") return c.redirect(`${base}/cdn/${digest}`, 307);
    const manifest = state.manifests.get(digest);
    return manifest ? c.body(Buffer.from(manifest)) : c.body(null, 404);
  });
  const server: Server = createServer(getRequestListener(app.fetch));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    ...state,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Publish an image of `layers` (bottom first) and return its manifest digest. */
function publish(registry: FakeRegistry, layers: Uint8Array[]): string {
  const descriptors = layers.map((bytes) => {
    const digest = digestOf(bytes);
    registry.blobs.set(digest, bytes);
    return { mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest, size: bytes.length };
  });
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 2, layers: descriptors }), "utf8");
  const digest = digestOf(manifest);
  registry.manifests.set(digest, manifest);
  return digest;
}

describe("pulling the Connect binaries", () => {
  let registry: FakeRegistry;

  beforeEach(async () => {
    registry = await startFakeRegistry();
  });

  afterEach(async () => {
    await registry.close();
  });

  const source = (digest: string): ImageSource => ({
    registry: registry.url,
    namespace: "1password",
    version: "9.9.9",
    manifests: { "connect-api": { amd64: digest }, "connect-sync": {} },
  });

  it("takes the executable out of the image's top layer, once", async () => {
    const digest = publish(registry, [
      await layer({ "etc/passwd": "opuser:x:999:999::/home/opuser:/bin/sh\n" }),
      await layer({ "usr/bin/connect-api": "#!/bin/sh\necho api\n" }),
    ]);

    const file = await ensureConnectBinary("connect-api", {
      dir,
      arch: "amd64",
      source: source(digest),
    });

    expect(file).toBe(path.join(dir, "bin", "9.9.9", "connect-api"));
    expect(await readFile(file, "utf8")).toBe("#!/bin/sh\necho api\n");
    expect((await stat(file)).mode & 0o777).toBe(0o755);
    // Only the top layer had to be read.
    expect(registry.requests.filter((r) => r.startsWith("blobs/"))).toHaveLength(1);

    registry.requests.length = 0;
    await ensureConnectBinary("connect-api", { dir, arch: "amd64", source: source(digest) });
    expect(registry.requests).toEqual([]);
  });

  it("refuses a manifest that isn't the pinned one", async () => {
    const real = publish(registry, [await layer({ "usr/bin/connect-api": "real" })]);
    // The registry serves other bytes under the pinned digest.
    registry.manifests.set(real, Buffer.from(JSON.stringify({ schemaVersion: 2, layers: [] })));

    await expect(
      ensureConnectBinary("connect-api", { dir, arch: "amd64", source: source(real) }),
    ).rejects.toThrow("The connect-api image manifest doesn't match its pinned digest.");
    await expect(stat(path.join(dir, "bin", "9.9.9", "connect-api"))).rejects.toThrow();
  });

  it("refuses a layer whose bytes don't match its digest", async () => {
    const digest = publish(registry, [await layer({ "usr/bin/connect-api": "real" })]);
    const [layerDigest] = [...registry.blobs.keys()];
    registry.blobs.set(layerDigest!, await layer({ "usr/bin/connect-api": "swapped" }));

    await expect(
      ensureConnectBinary("connect-api", { dir, arch: "amd64", source: source(digest) }),
    ).rejects.toThrow("A connect-api image layer doesn't match its digest.");
  });
});

describe("credentials", () => {
  const file = JSON.stringify({ verifier: { salt: "s" }, deviceUuid: "dev-1", version: "2" });
  const base64 = Buffer.from(file).toString("base64");

  it("takes the credentials file as JSON or as base64", () => {
    expect(sessionFromCredentials(file)).toBe(base64);
    expect(sessionFromCredentials(`'${base64}'`)).toBe(base64);
  });

  it("refuses anything that isn't the credentials file", () => {
    expect(() => sessionFromCredentials("op-token-not-a-file")).toThrow(
      "OP_CONNECT_CREDENTIALS must hold the 1password-credentials.json file, as JSON or base64.",
    );
  });
});

describe("running the bundled server", () => {
  let connect: BundledConnect | undefined;

  afterEach(async () => {
    await connect?.stop();
    connect = undefined;
  });

  const ports = { api: 1, sync: 2, apiBus: 3, syncBus: 4 };

  /** A stand-in executable: records its env, fails its first run when asked, then stays up. */
  async function fakeBinary(name: string, failFirst = false): Promise<string> {
    const file = path.join(dir, name);
    await writeFile(
      file,
      [
        "#!/bin/sh",
        `echo started >> "$HOME/${name}.runs"`,
        `env > "$HOME/${name}.env"`,
        failFirst
          ? `[ -f "$HOME/${name}.failed" ] || { touch "$HOME/${name}.failed"; exit 3; }`
          : "",
        "exec sleep 30",
      ].join("\n"),
      { mode: 0o755 },
    );
    return file;
  }

  const envOf = async (name: string) =>
    Object.fromEntries(
      (await readFile(path.join(dir, "home", `${name}.env`), "utf8"))
        .split("\n")
        .filter((line) => line.startsWith("OP_") || line.startsWith("HOME="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );

  it("starts both processes with the bus wired between them over loopback", async () => {
    const binaries = {
      "connect-api": await fakeBinary("connect-api"),
      "connect-sync": await fakeBinary("connect-sync"),
    };
    connect = startBundledConnect({
      session: "c2Vzc2lvbg==",
      dir,
      ports,
      binary: async (name) => binaries[name],
    });

    await until(() => connect!.state().state === "running", "both processes running");
    await until(
      () => stat(path.join(dir, "home", "connect-sync.env")).catch(() => null),
      "sync env",
    );
    await until(() => stat(path.join(dir, "home", "connect-api.env")).catch(() => null), "api env");

    expect(await envOf("connect-api")).toEqual({
      HOME: path.join(dir, "home"),
      OP_SESSION: "c2Vzc2lvbg==",
      OP_HTTP_PORT: "1",
      OP_BUS_PORT: "3",
      OP_BUS_PEERS: "localhost:4",
      OP_LOG_LEVEL: "info",
    });
    expect(await envOf("connect-sync")).toMatchObject({
      OP_HTTP_PORT: "2",
      OP_BUS_PORT: "4",
      OP_BUS_PEERS: "localhost:3",
    });
  });

  it("starts a process that exits again", async () => {
    const binaries = {
      "connect-api": await fakeBinary("connect-api"),
      "connect-sync": await fakeBinary("connect-sync", true),
    };
    connect = startBundledConnect({
      session: "c2Vzc2lvbg==",
      dir,
      ports,
      restartDelayMs: 10,
      binary: async (name) => binaries[name],
    });

    const runs = path.join(dir, "home", "connect-sync.runs");
    await until(
      async () => (await readFile(runs, "utf8").catch(() => "")).split("\n").length > 2,
      "sync started twice",
    );
    expect((await readFile(runs, "utf8")).trim().split("\n")).toEqual(["started", "started"]);
    await until(() => connect!.state().state === "running", "running again");
  });

  it("says why it can't start when a binary can't be had", async () => {
    connect = startBundledConnect({
      session: "c2Vzc2lvbg==",
      dir,
      ports,
      binary: async () => {
        throw new Error("1Password Connect has no build for this CPU (ia32).");
      },
    });

    await until(() => connect!.state().state === "failed", "failed state");
    expect(connect.state()).toEqual({
      state: "failed",
      detail: "1Password Connect has no build for this CPU (ia32).",
    });
  });

  it("runs on Linux only", async () => {
    connect = startBundledConnect({
      session: "c2Vzc2lvbg==",
      dir,
      ports,
      platform: "darwin",
      binary: async () => "/bin/true",
    });

    await until(() => connect!.state().state === "failed", "failed state");
    expect(connect.state().detail).toBe(
      "The bundled Connect server runs on Linux only; set OP_CONNECT_HOST to a Connect server instead.",
    );
  });
});
