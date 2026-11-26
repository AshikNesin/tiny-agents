/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Login } from "@groot/shell/pages/auth/Login";
import { useAuthStore, type SessionUser } from "@groot/shell/store/auth";

const USER: SessionUser = { id: 1, email: "demo@example.com", name: "Demo", isAdmin: false };

function deferred() {
  let settle!: { resolve: (user: SessionUser) => void; reject: (error: Error) => void };
  const promise = new Promise<SessionUser>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { promise, ...settle };
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<p>home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const initial = useAuthStore.getState();

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ success: true, data: { needsSetup: false } }), { status: 200 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState(initial, true);
});

describe("Login sign-in", () => {
  it("runs one passkey sign-in at a time and holds the password form meanwhile", async () => {
    const pending = deferred();
    const loginWithPasskey = vi.fn(() => pending.promise);
    const login = vi.fn(async () => USER);
    useAuthStore.setState({ loginWithPasskey, login });
    const user = userEvent.setup();
    renderLogin();

    await user.click(await screen.findByRole("button", { name: "Sign in with passkey" }));
    const busy = screen.getByRole("button", { name: "Waiting for passkey…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Sign In" })).toBeDisabled();

    await user.click(busy);
    expect(loginWithPasskey).toHaveBeenCalledTimes(1);

    pending.resolve(USER);
    expect(await screen.findByText("home")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("goes back to idle after a failed sign-in, so the person can try again", async () => {
    const loginWithPasskey = vi.fn(async () => {
      throw new Error("No passkey");
    });
    useAuthStore.setState({ loginWithPasskey });
    const user = userEvent.setup();
    renderLogin();

    const button = await screen.findByRole("button", { name: "Sign in with passkey" });
    await user.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(loginWithPasskey).toHaveBeenCalledTimes(2);
  });

  it("disables the passkey button while a password sign-in runs", async () => {
    const pending = deferred();
    const login = vi.fn(() => pending.promise);
    useAuthStore.setState({ login });
    const user = userEvent.setup();
    renderLogin();

    const email = await screen.findByLabelText("Email");
    await user.clear(email);
    await user.type(email, "demo@example.com");
    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(await screen.findByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign in with passkey" })).toBeDisabled();

    pending.resolve(USER);
    expect(await screen.findByText("home")).toBeInTheDocument();
  });
});
