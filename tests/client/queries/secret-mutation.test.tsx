/**
 * Writes that carry a secret (rewrite step 5.3: a vault value, a connection's
 * header secret, a provider key, a revealed value) leave nothing in React
 * Query once answered, and the vault overview reads the backends again only
 * when Refresh asks.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vite-plus/test";
import { useSecretMutation } from "@/queries/resource";
import { useVaultOverview } from "@/queries/vault";
import { AppQueryProvider } from "../query-provider";

const overviewMock = vi.fn();
vi.mock("@/lib/vault-api", () => ({
  vaultApi: { overview: (...args: unknown[]) => overviewMock(...args) },
}));

let client!: QueryClient;
let write!: (secret: string) => Promise<string>;

function SecretProbe({ fn }: { fn: (secret: string) => Promise<string> }) {
  client = useQueryClient();
  write = useSecretMutation(fn).mutateAsync;
  return null;
}

describe("useSecretMutation", () => {
  it("keeps neither what it sent nor what it got once answered", async () => {
    render(
      <AppQueryProvider>
        <SecretProbe fn={async (secret) => `revealed:${secret}`} />
      </AppQueryProvider>,
    );
    let answer!: string;
    await act(async () => {
      answer = await write("hunter2");
    });
    expect(answer).toBe("revealed:hunter2");
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });

  it("drops a failed write too, and rejects with the error as thrown", async () => {
    const error = new Error("Confirm it's you first");
    render(
      <AppQueryProvider>
        <SecretProbe fn={() => Promise.reject(error)} />
      </AppQueryProvider>,
    );
    await act(async () => {
      await expect(write("sk-live")).rejects.toBe(error);
    });
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });
});

let reload!: (refresh?: boolean) => Promise<void>;
function OverviewProbe() {
  const overview = useVaultOverview();
  reload = overview.reload;
  return <p>{overview.data ? "loaded" : "loading"}</p>;
}

describe("useVaultOverview", () => {
  it("reads the backends again only on reload(true)", async () => {
    overviewMock.mockResolvedValue({ items: [] });
    render(
      <AppQueryProvider>
        <OverviewProbe />
      </AppQueryProvider>,
    );
    expect(await screen.findByText("loaded")).toBeTruthy();
    await act(() => reload(true));
    await act(() => reload());
    expect(overviewMock.mock.calls).toEqual([[false], [true], [false]]);
  });
});
