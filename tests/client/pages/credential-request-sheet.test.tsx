/**
 * @vitest-environment jsdom
 *
 * The credential request sheet: a bot asked the owner to sign in. The card
 * holds the fields, Continue and Cancel, and nothing else to act on.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vite-plus/test";
import { CredentialRequestSheet } from "@/pages/vault/CredentialRequestSheet";
import type { CredentialRequestView } from "../../../apps/web/src/shared/api/vault";
import { FIXED_NOW } from "../../test-clock";
import { AppQueryProvider } from "../query-provider";

const REQUEST: CredentialRequestView = {
  taskId: 7,
  bot: { id: "chief", name: "Chief" },
  origin: "https://www.amazon.in",
  title: "Sign in to Amazon.in",
  purpose: "Start the return of your recent order",
  fields: [
    {
      key: "email",
      label: "Email or mobile number",
      type: "email",
      required: true,
      autocomplete: "email",
    },
    {
      key: "password",
      label: "Amazon password",
      type: "password",
      required: true,
      autocomplete: "current-password",
    },
  ],
  savedHandle: null,
  expiresAt: Date.parse(FIXED_NOW) + 10 * 60_000,
  liveOrigin: "https://www.amazon.in",
};

vi.mock("@/lib/vault-api", () => ({
  apiError: (_error: unknown, fallback: string) => fallback,
  vaultApi: { request: vi.fn(async () => REQUEST) },
}));

describe("credential request sheet", () => {
  it("offers Continue and Cancel, and no Live browser link", async () => {
    render(
      <AppQueryProvider>
        <MemoryRouter>
          <CredentialRequestSheet taskId={7} />
        </MemoryRouter>
      </AppQueryProvider>,
    );
    expect(await screen.findByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /live browser/i })).toBeNull();
  });
});
