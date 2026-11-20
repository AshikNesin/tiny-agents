import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export const CONNECT_VERSION = "1.8.4";

export type ConnectBinary = "connect-api" | "connect-sync";
type Arch = "amd64" | "arm64";

const PINNED: Record<ConnectBinary, Record<Arch, string>> = {
  "connect-api": {
    amd64: "sha256:fbb1b35c38a63559becbed640550d3a844f03c7474ca74bbec727bb12107ff3a",
    arm64: "sha256:19193e569285dcaa622e6679b3114360aa602f904be6aab3b1753f3a79499f3d",
  },
  "connect-sync": {
    amd64: "sha256:0c2c6b481a2e717afc5a46e5a5a0847ae9d2a04407e502f1567c8a66cd76e757",
    arm64: "sha256:9a3aa3de5b2e481a2c34cf77f9b6565d7b1eac44c82921cc3b17ebcae942b6cd",
  },
};

export interface ImageSource {
  registry: string;
  namespace: string;
  version: string;
  manifests: Record<ConnectBinary, Partial<Record<Arch, string>>>;
}

const DEFAULT_SOURCE: ImageSource = {
  registry: "https://ghcr.io",
  namespace: "1password",
  version: CONNECT_VERSION,
  manifests: PINNED,
};

function imageArch(arch: string = process.arch): Arch | undefined {
  if (arch === "x64") return "amd64";
  if (arch === "arm64") return "arm64";
  return undefined;
}

const sha256 = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

interface Manifest {
  layers?: { digest: string; mediaType?: string }[];
}

function registryClient(source: ImageSource, repo: string, doFetch: typeof fetch) {
  let token: string | undefined;

  async function authenticate(challenge: string | null): Promise<void> {
    const params = Object.fromEntries(
      [...(challenge ?? "").matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]),
    );
    if (!params.realm || !URL.canParse(params.realm)) {
      throw new Error(`The registry asked for sign-in it didn't describe.`);
    }
    const url = new URL(params.realm);
    if (params.service) url.searchParams.set("service", params.service);
    url.searchParams.set("scope", params.scope ?? `repository:${repo}:pull`);
    const response = await doFetch(url);
    if (!response.ok) throw new Error(`The registry refused a pull token (${response.status}).`);
    const body = (await response.json()) as { token?: string; access_token?: string };
    token = body.token ?? body.access_token;
    if (!token) throw new Error("The registry returned no pull token.");
  }

  return async function get(pathname: string, accept?: string): Promise<Uint8Array> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await doFetch(`${source.registry}/v2/${repo}/${pathname}`, {
        headers: {
          ...(accept ? { Accept: accept } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        redirect: "follow",
        signal: AbortSignal.timeout(5 * 60_000),
      });
      if (response.status === 401 && attempt === 0) {
        await authenticate(response.headers.get("www-authenticate"));
        continue;
      }
      if (!response.ok)
        throw new Error(`The registry answered ${response.status} for ${pathname}.`);
      return new Uint8Array(await response.arrayBuffer());
    }
    throw new Error("The registry kept refusing the pull token.");
  };
}

function findInTar(tar: Uint8Array, suffix: string): Uint8Array | undefined {
  const text = (start: number, length: number) => {
    const slice = tar.subarray(start, start + length);
    const end = slice.indexOf(0);
    return Buffer.from(end === -1 ? slice : slice.subarray(0, end)).toString("utf8");
  };
  let offset = 0;
  let longName: string | undefined;
  while (offset + 512 <= tar.length) {
    if (tar.subarray(offset, offset + 512).every((byte) => byte === 0)) break;
    const size = Number.parseInt(text(offset + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[offset + 156] ?? 0);
    const prefix = text(offset + 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${text(offset, 100)}` : text(offset, 100));
    longName = undefined;
    const body = offset + 512;
    if (type === "L") {
      longName = text(body, size);
    } else if (type === "x") {
      const pax = /\d+ path=([^\n]*)\n/.exec(text(body, size));
      if (pax) longName = pax[1];
    } else if ((type === "0" || type === "\0") && `/${name}`.endsWith(`/${suffix}`)) {
      return tar.slice(body, body + size);
    }
    offset = body + Math.ceil(size / 512) * 512;
  }
  return undefined;
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    (info) => info.isFile(),
    () => false,
  );
}

export async function ensureConnectBinary(
  binary: ConnectBinary,
  options: { dir: string; arch?: Arch; source?: ImageSource; fetch?: typeof fetch },
): Promise<string> {
  const source = options.source ?? DEFAULT_SOURCE;
  const arch = options.arch ?? imageArch();
  const digest = arch ? source.manifests[binary][arch] : undefined;
  if (!arch || !digest) {
    throw new Error(`1Password Connect has no build for this CPU (${process.arch}).`);
  }
  const target = path.join(options.dir, "bin", source.version, binary);
  if (await exists(target)) return target;

  const repo = `${source.namespace}/${binary}`;
  const get = registryClient(source, repo, options.fetch ?? fetch);
  const manifestBytes = await get(
    `manifests/${digest}`,
    "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
  );
  if (sha256(manifestBytes) !== digest) {
    throw new Error(`The ${binary} image manifest doesn't match its pinned digest.`);
  }
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8")) as Manifest;
  for (const layer of (manifest.layers ?? []).toReversed()) {
    const blob = await get(`blobs/${layer.digest}`);
    if (sha256(blob) !== layer.digest) {
      throw new Error(`A ${binary} image layer doesn't match its digest.`);
    }
    const tar = layer.mediaType?.endsWith("+gzip") === false ? blob : gunzipSync(blob);
    const file = findInTar(tar, `bin/${binary}`);
    if (!file) continue;
    await mkdir(path.dirname(target), { recursive: true });
    const partial = `${target}.partial`;
    await writeFile(partial, file, { mode: 0o755 });
    await chmod(partial, 0o755);
    await rename(partial, target);
    return target;
  }
  throw new Error(`The ${binary} image has no ${binary} executable.`);
}

export async function pruneOtherVersions(dir: string, version = CONNECT_VERSION): Promise<void> {
  const root = path.join(dir, "bin");
  const entries = await readdir(root).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((entry) => entry !== version)
      .map((entry) => rm(path.join(root, entry), { recursive: true, force: true })),
  );
}
