import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createNamespaceKv } from "@groot/core/kv";
import { db, vaultItems, vaultValues } from "../../../apps/web/src/server/db";
import { resetAppTables } from "../fixtures";
import { setVaultBackendsForTests } from "../../../apps/web/src/server/api/vault/backends";
import { createLocalBackend } from "../../../apps/web/src/server/api/vault/backends/local";
import {
  clearStatusCache,
  forgetAppCredential,
} from "../../../apps/web/src/server/api/vault/vault.service";
import { installAppForTests } from "../../../apps/web/src/server/app-root";
import { setGitHubToken } from "../../../apps/web/src/server/api/code/code.github";

interface GitHubSettings {
  tokenHandle?: string;
  app?: { slug: string; keyHandle: string; webhookSecretHandle: string | null };
}

async function readSettings(): Promise<GitHubSettings> {
  return (await createNamespaceKv("CODE_GITHUB").get<GitHubSettings>("settings")) ?? {};
}

beforeEach(async () => {
  await resetAppTables();
  await createNamespaceKv("CODE_GITHUB").clear();
  const backend = createLocalBackend();
  setVaultBackendsForTests(new Map([["local", backend]]));
  clearStatusCache();
  forgetAppCredential();
  installAppForTests({ codeGitHubApp: undefined });
});

describe("GitHub settings under concurrency", () => {
  it("keeps the App config and leaves no orphaned token when two token writes race", async () => {
    await createNamespaceKv("CODE_GITHUB").set("settings", {
      app: {
        appId: "99",
        slug: "tiny-agents",
        name: "tiny-agents",
        keyHandle: "code-github-app-key-old",
        webhookSecretHandle: null,
      },
    });

    await Promise.all([
      setGitHubToken("ghp_aaaaaaaaaaaaaaaaaaaa"),
      setGitHubToken("ghp_bbbbbbbbbbbbbbbbbbbb"),
    ]);

    const settings = await readSettings();
    expect(settings.app?.slug).toBe("tiny-agents");
    expect(settings.app?.keyHandle).toBe("code-github-app-key-old");
    expect(settings.tokenHandle).toMatch(/^code-github-/);
    const rows = await db.select({ handle: vaultItems.handle }).from(vaultItems);
    expect(rows.map((r) => r.handle)).toEqual([settings.tokenHandle]);
    expect(await db.$count(vaultValues)).toBe(1);
  });

  it("replaces a token without leaving the previous credential behind", async () => {
    await setGitHubToken("ghp_firstaaaaaaaaaaaaaaaaaaa");
    const before = await readSettings();
    expect(before.tokenHandle).toMatch(/^code-github-/);
    await Promise.all([setGitHubToken("ghp_secondaaaaaaaaaaaaaaaaaa"), setGitHubToken(null)]);
    const settings = await readSettings();
    expect(settings.tokenHandle).toBeUndefined();
    expect(await db.select({ handle: vaultItems.handle }).from(vaultItems)).toEqual([]);
    expect(await db.$count(vaultValues)).toBe(0);
  });
});
