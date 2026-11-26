import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { ConnectionStatusCard } from "@/pages/connections/detail/ConnectionStatusCard";
import type { Connection } from "../../../apps/web/src/shared/api/connections";
import { FIXED_NOW } from "../../test-clock";

function connection(partial: Partial<Connection>): Connection {
  return {
    id: "c1",
    name: "Executor.sh",
    slug: "executor",
    url: "https://mcp.example.test/mcp",
    transport: "streamable-http",
    authType: "oauth",
    headerName: null,
    hasSecret: false,
    secretRef: null,
    tools: [],
    allBots: false,
    botIds: [],
    status: "connected",
    createdAt: new Date(FIXED_NOW).toISOString(),
    ...partial,
  };
}

function mount(value: Connection) {
  render(
    <ConnectionStatusCard
      connection={value}
      busy={false}
      onSignIn={() => undefined}
      onReconnect={() => undefined}
    />,
  );
}

describe("ConnectionStatusCard", () => {
  it("offers only Sign in when the saved sign-in can't be read", () => {
    mount(
      connection({
        status: "needs_auth",
        error: "The saved sign-in can't be read anymore. Sign in again.",
      }),
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  });
});
