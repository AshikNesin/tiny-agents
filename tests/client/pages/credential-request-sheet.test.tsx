/**
 * @vitest-environment jsdom
 *
 * A credential request's link (`/vault/requests/<task>`, the push
 * notification's) opens the asking bot's chat on its sign-in card, where
 * the form now lives.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vite-plus/test";
import { CredentialRequestSheet } from "@/pages/vault/CredentialRequestSheet";
import type { CredentialRequestView } from "../../../apps/web/src/shared/api/vault";
import { FIXED_NOW } from "../../test-clock";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

const REQUEST: CredentialRequestView = {
  taskId: 7,
  bot: { id: "chief", name: "Chief" },
  origin: "https://www.amazon.in",
  title: "Sign in to Amazon.in",
  purpose: "Start the return of your recent order",
  fields: [{ key: "email", label: "Email", type: "email", required: true, autocomplete: "email" }],
  frameOrigin: null,
  savedHandle: null,
  expiresAt: Date.parse(FIXED_NOW) + 10 * 60_000,
  liveOrigin: "https://www.amazon.in",
};

function Where() {
  const location = useLocation();
  return <p>at {location.pathname + location.search}</p>;
}

describe("credential request link", () => {
  it("opens the bot's chat on the sign-in card", async () => {
    fakeApi().get("/vault/requests/:taskId", () => REQUEST);
    render(
      <AppQueryProvider>
        <MemoryRouter initialEntries={["/vault/requests/7"]}>
          <Routes>
            <Route path="/vault/requests/:taskId" element={<CredentialRequestSheet taskId={7} />} />
            <Route path="/chats/:botId" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </AppQueryProvider>,
    );
    expect(await screen.findByText("at /chats/chief?focus=credentials%3A7")).toBeTruthy();
  });
});
