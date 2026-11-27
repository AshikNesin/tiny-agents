import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vite-plus/test";
import { useSecretMutation } from "@/queries/resource";
import { useVaultOverview } from "@/queries/vault";
import type { VaultOverview } from "../../../apps/web/src/shared/api/vault";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

const emptyVault: VaultOverview = {
  backends: [],
  primaryBackend: "local",
  items: [],
  unlinked: [],
  kindDefaults: { login: [], card: [], identity: [], api_key: [] },
  movableToOnePassword: 0,
};

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
  return <p>{overview.status === "ready" ? "loaded" : "loading"}</p>;
}

describe("useVaultOverview", () => {
  it("reads the backends again only on reload(true)", async () => {
    const api = fakeApi();
    api.get("/vault", () => emptyVault);
    render(
      <AppQueryProvider>
        <OverviewProbe />
      </AppQueryProvider>,
    );
    expect(await screen.findByText("loaded")).toBeTruthy();
    await act(() => reload(true));
    await act(() => reload());
    expect(api.sent("GET", "/vault").map((request) => request.query.toString())).toEqual([
      "",
      "refresh=1",
      "",
    ]);
  });
});
