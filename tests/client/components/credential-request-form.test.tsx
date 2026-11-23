/**
 * @vitest-environment jsdom
 *
 * The form's submit must respect the same gating as the disabled Continue
 * button: a page that has moved away from the request origin is never
 * submitted to, even when the browser fires an implicit submit (Enter).
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { CredentialRequestForm } from "@/components/vault/CredentialRequestForm";
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
    { key: "email", label: "Email", type: "email", required: true, autocomplete: "email" },
    {
      key: "password",
      label: "Password",
      type: "password",
      required: true,
      autocomplete: "current-password",
    },
  ],
  frameOrigin: null,
  savedHandle: null,
  expiresAt: Date.parse(FIXED_NOW) + 10 * 60_000,
  liveOrigin: "https://www.amazon.in",
};

const api = vi.hoisted(() => ({ submitRequest: vi.fn(), cancelRequest: vi.fn() }));
vi.mock("@/lib/vault-api", () => ({ apiError: (_e: unknown, f: string) => f }));
vi.mock("@/queries/vault", () => ({
  useVaultMutations: () => ({
    submitRequest: { mutateAsync: api.submitRequest },
    cancelRequest: { mutateAsync: api.cancelRequest },
  }),
}));

function mount(request: CredentialRequestView) {
  return render(
    <AppQueryProvider>
      <CredentialRequestForm taskId={request.taskId} request={request} onSettled={() => {}} />
    </AppQueryProvider>,
  );
}

describe("credential request form gating", () => {
  it("submits a complete form on the request's own page", async () => {
    api.submitRequest.mockResolvedValue({ filled: ["email", "password"], savedHandle: null });
    mount(REQUEST);
    fireEvent.change(await screen.findByLabelText("Email*"), {
      target: { value: "ana@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password*"), { target: { value: "pw" } });
    fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
    await waitFor(() => expect(api.submitRequest).toHaveBeenCalledTimes(1));
  });

  it("does not submit a form whose page moved away from the origin", async () => {
    mount({ ...REQUEST, liveOrigin: "https://evil.example" });
    fireEvent.change(await screen.findByLabelText("Email*"), {
      target: { value: "ana@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password*"), { target: { value: "pw" } });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
    await waitFor(() => expect(screen.getByText(/Nothing will be filled there/)).toBeTruthy());
    expect(api.submitRequest).not.toHaveBeenCalled();
  });
});
