/**
 * @vitest-environment jsdom
 *
 * The form's submit must respect the same gating as the disabled Continue
 * button: a page that has moved away from the request origin is never
 * submitted to, even when the browser fires an implicit submit (Enter).
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { CredentialRequestForm } from "@/components/vault/CredentialRequestForm";
import { StepUpProvider } from "@/components/vault/StepUp";
import { vaultApi } from "@/lib/vault-api";
import type {
  CredentialRequestView,
  CredentialSubmitted,
} from "../../../apps/web/src/shared/api/vault";
import { FIXED_NOW } from "../../test-clock";
import { fakeApi } from "../fakes/api";
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

const SUBMITTED: CredentialSubmitted = {
  filled: ["email", "password"],
  savedHandle: null,
  saveFailed: false,
};

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  vaultApi.forgetStepUp();
  api = fakeApi();
});

const submits = () => api.sent("POST", "/vault/requests/7/submit");

function mount(request: CredentialRequestView) {
  return render(
    <AppQueryProvider>
      <StepUpProvider>
        <CredentialRequestForm taskId={request.taskId} request={request} onSettled={() => {}} />
      </StepUpProvider>
    </AppQueryProvider>,
  );
}

describe("credential request form gating", () => {
  it("submits a complete form on the request's own page", async () => {
    api.post("/vault/requests/7/submit", () => SUBMITTED);
    mount(REQUEST);
    fireEvent.change(await screen.findByLabelText("Email*"), {
      target: { value: "ana@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password*"), { target: { value: "pw" } });
    fireEvent.submit(screen.getByRole("button", { name: "Continue" }).closest("form")!);
    await waitFor(() => expect(submits()).toHaveLength(1));
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
    expect(submits()).toHaveLength(0);
  });

  it("sends a saving submit without asking to confirm it's you", async () => {
    api.post("/vault/requests/7/submit", () => SUBMITTED);
    mount(REQUEST);
    fireEvent.change(await screen.findByLabelText("Email*"), {
      target: { value: "ana@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password*"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(submits()).toHaveLength(1));
    expect(submits()[0]!.body).toEqual({
      values: { email: "ana@example.com", password: "pw" },
      save: true,
    });
    expect(screen.queryByText("Confirm it's you")).toBeNull();

    fireEvent.change(screen.getByLabelText("Email*"), { target: { value: "ana@example.com" } });
    fireEvent.change(screen.getByLabelText("Password*"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("switch", { name: "Save to vault" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(submits()).toHaveLength(2));
    expect(submits()[1]!.body).toEqual({
      values: { email: "ana@example.com", password: "pw" },
      save: false,
    });
    expect(screen.queryByText("Confirm it's you")).toBeNull();
    expect(api.sent("POST", "/vault/step-up")).toHaveLength(0);
    expect(submits().map((request) => request.headers.get("X-Vault-Step-Up"))).toEqual([
      null,
      null,
    ]);
  });

  it("accepts a plain username in a field the bot typed as email", async () => {
    mount({
      ...REQUEST,
      fields: [
        {
          key: "login",
          label: "Username (or Email)",
          type: "email",
          required: true,
          autocomplete: "username",
        },
        REQUEST.fields[1]!,
      ],
    });
    fireEvent.change(await screen.findByLabelText("Username (or Email)*"), {
      target: { value: "AshikNesin" },
    });
    fireEvent.change(screen.getByLabelText("Password*"), { target: { value: "pw" } });
    const form = screen.getByRole("button", { name: "Continue" }).closest("form")!;
    expect(form.checkValidity()).toBe(true);
  });
});
