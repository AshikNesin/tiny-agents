import { it, expect, vi } from "vite-plus/test";

/**
 * Boot-time provider assertion in packages/core/src/database/client.ts.
 *
 * `prisma generate` bakes the datasource provider into the generated client,
 * and the build step regenerates per engine, so a mismatched pair (sqlite
 * client + postgres URL, or the reverse) only surfaces deep in the first
 * query — or worse, silently writes to the wrong engine. The assertion in
 * createPrismaClient closes that gap at boot. This test boots the module
 * with a deliberately mismatched URL and asserts the fail-fast error names
 * both providers.
 *
 * The generated client in this checkout targets whichever engine
 * `prisma generate` last ran for; the test derives the opposite URL scheme
 * so it proves the mismatch on either leg of the CI matrix.
 */

const scratchUrl = "file:./tmp/af13-provider-probe.db";

// varlock resolves ENV into a snapshot at import — mutating process.env
// afterwards has no effect, so the URL must be mocked at the module layer
// (same pattern as tests/server/server/kv/kv.test.ts). The default matches
// whichever engine the checkout's generated client targets.
const urlNow = () =>
  process.env.AF13_PROVIDER_PROBE_URL ??
  (generatedProviderRef.current.startsWith("postgres")
    ? "postgresql://postgres:postgres@localhost:5432/groot_test"
    : scratchUrl);
const generatedProviderRef = { current: "" };
vi.mock("varlock/env", () => ({
  ENV: new Proxy(
    { NODE_ENV: "test" },
    {
      get(target, prop) {
        if (prop === "DATABASE_URL") return urlNow();
        return target[prop as keyof typeof target];
      },
    },
  ),
}));

const { generatedProvider } = await import("@groot/core/database/generated-provider");
generatedProviderRef.current = generatedProvider;
const urlProvider = (url: string) => (url.trim().startsWith("postgres") ? "postgres" : "sqlite");
// The mismatch is whichever URL scheme contradicts the checkout's generated
// client, so the test proves the failure on either CI leg.
const isSqliteClient = !generatedProvider.startsWith("postgres");
const mismatchedUrl = isSqliteClient
  ? "postgresql://postgres:postgres@localhost:5432/groot_test"
  : scratchUrl;

it("boots with a provider that matches the URL scheme", async () => {
  const mod = await import("@groot/core/database/client");
  expect(mod.prisma).toBeTruthy();
  await mod.prisma.$disconnect();
});

it("fails fast when the URL scheme contradicts the generated provider", async () => {
  process.env.AF13_PROVIDER_PROBE_URL = mismatchedUrl;
  // client.ts caches the singleton on globalThis; drop it so the re-import
  // actually re-runs createPrismaClient with the mismatched URL.
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  await expect(import("@groot/core/database/client")).rejects.toThrow(
    `Prisma client provider mismatch: the generated client targets ${generatedProvider} but DATABASE_URL (${mismatchedUrl}) selects ${urlProvider(mismatchedUrl)}.`,
  );
  delete process.env.AF13_PROVIDER_PROBE_URL;
});
