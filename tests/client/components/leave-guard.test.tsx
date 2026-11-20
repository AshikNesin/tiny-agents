import React, { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { Link, RouterProvider, createMemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { LeaveGuard } from "@/components/LeaveGuard";

function Editor() {
  const [text, setText] = useState("");
  return (
    <>
      <LeaveGuard when={text !== ""} />
      <input aria-label="Body" value={text} onChange={(e) => setText(e.target.value)} />
      <Link to="/elsewhere">Leave</Link>
    </>
  );
}

function mount() {
  const router = createMemoryRouter(
    [
      { path: "/edit", element: <Editor /> },
      { path: "/elsewhere", element: <p>Elsewhere</p> },
    ],
    { initialEntries: ["/edit"] },
  );
  render(
    <GrootUIProvider>
      <RouterProvider router={router} />
    </GrootUIProvider>,
  );
  return router;
}

describe("LeaveGuard", () => {
  it("leaves a clean page without asking", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("link", { name: "Leave" }));
    expect(await screen.findByText("Elsewhere")).toBeTruthy();
  });

  it("asks before leaving unsaved edits, and keeps them on Keep editing", async () => {
    const user = userEvent.setup();
    const router = mount();
    await user.type(screen.getByLabelText("Body"), "draft");
    await user.click(screen.getByRole("link", { name: "Leave" }));

    expect(await screen.findByText("Discard unsaved changes?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.pathname).toBe("/edit");
    expect((screen.getByLabelText("Body") as HTMLInputElement).value).toBe("draft");

    await user.click(await screen.findByRole("link", { name: "Leave" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(await screen.findByText("Elsewhere")).toBeTruthy();
  });

  it("arms the browser's leave prompt only while there are edits", async () => {
    const user = userEvent.setup();
    mount();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await user.type(screen.getByLabelText("Body"), "x");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});
