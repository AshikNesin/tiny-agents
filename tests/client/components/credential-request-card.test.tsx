/**
 * @vitest-environment jsdom
 *
 * A bot's credential request is filled in its chat: the card holds the form,
 * and what the owner types goes to the request's submit route, never into
 * the chat.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChatMessageView } from "@/components/ChatMessageView";
import type { ChatMessage, ChatToolCall } from "@/lib/chat-types";
import { OwnerActionsProvider, type OwnerActions } from "@/lib/owner-actions";
import type { CredentialRequestView } from "../../../apps/web/src/shared/api/vault";
import { FIXED_NOW } from "../../test-clock";
import { AppQueryProvider } from "../query-provider";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const expiresAt = Date.parse(FIXED_NOW) + 10 * 60_000;
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
  expiresAt,
  liveOrigin: "https://www.amazon.in",
};

const api = vi.hoisted(() => ({
  request: vi.fn(),
  submitRequest: vi.fn(),
  cancelRequest: vi.fn(),
}));
vi.mock("@/lib/vault-api", () => ({
  apiError: (_error: unknown, fallback: string) => fallback,
  vaultApi: api,
}));

const actions: OwnerActions = { decideApproval: vi.fn(), answerQuestions: vi.fn() };

function chat(): ChatMessage {
  const call: ChatToolCall = {
    id: "t1",
    name: "request_credentials",
    args: {},
    status: "awaiting_credentials",
    taskId: 7,
    expiresAt,
    credentials: {
      status: "pending",
      origin: REQUEST.origin,
      title: REQUEST.title,
      purpose: REQUEST.purpose,
      fields: REQUEST.fields.map(({ key, label, type, required }) => ({
        key,
        label,
        type,
        required,
      })),
    },
  };
  return { id: "m1", role: "assistant", text: "", status: "done", createdAt: 0, toolCalls: [call] };
}

describe("credential request in the chat", () => {
  it("fills the sign-in from the chat card, saving to the vault", async () => {
    api.request.mockResolvedValue(REQUEST);
    api.submitRequest.mockResolvedValue({
      filled: ["email", "password"],
      savedHandle: "amazon-in",
      saveFailed: false,
    });
    render(
      <AppQueryProvider>
        <MemoryRouter>
          <OwnerActionsProvider actions={actions}>
            <ChatMessageView message={chat()} botName="Chief" />
          </OwnerActionsProvider>
        </MemoryRouter>
      </AppQueryProvider>,
    );
    const card = document.querySelector('[data-waiting="credentials:7"]');
    expect(card).not.toBeNull();
    await userEvent.type(await screen.findByLabelText("Email*"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Password*"), "canary-pw");
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(api.submitRequest).toHaveBeenCalledWith(
        7,
        { email: "ana@example.com", password: "canary-pw" },
        true,
      ),
    );
  });

  it("offers to save a mobile-number sign-in to the vault", async () => {
    api.request.mockResolvedValue({
      ...REQUEST,
      fields: [
        {
          key: "mobile",
          label: "Mobile number",
          type: "text",
          required: true,
          autocomplete: "tel",
        },
        { key: "code", label: "OTP", type: "otp", required: false, autocomplete: "one-time-code" },
      ],
    });
    render(
      <AppQueryProvider>
        <MemoryRouter>
          <OwnerActionsProvider actions={actions}>
            <ChatMessageView message={chat()} botName="Chief" />
          </OwnerActionsProvider>
        </MemoryRouter>
      </AppQueryProvider>,
    );
    expect(await screen.findByLabelText("Mobile number*")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Save to vault" })).toBeTruthy();
  });

  it("names the other site's sign-in frame it fills in (#302)", async () => {
    api.request.mockResolvedValue({
      ...REQUEST,
      origin: "https://www.thehindu.com",
      frameOrigin: "https://id.tinypass.com",
      liveOrigin: "https://www.thehindu.com",
    });
    render(
      <AppQueryProvider>
        <MemoryRouter>
          <OwnerActionsProvider actions={actions}>
            <ChatMessageView message={chat()} botName="Chief" />
          </OwnerActionsProvider>
        </MemoryRouter>
      </AppQueryProvider>,
    );
    expect(
      await screen.findByText(
        /Only filled on www\.thehindu\.com, in its sign-in frame from id\.tinypass\.com\./,
      ),
    ).toBeTruthy();
  });
});
