/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vite-plus/test";
import { Markdown } from "@/lib/markdown";

async function show(text: string, streaming = false) {
  return act(() =>
    render(
      <MemoryRouter>
        <Markdown streaming={streaming}>{text}</Markdown>
      </MemoryRouter>,
    ),
  );
}

describe("Markdown mermaid blocks", () => {
  it("draws a mermaid fence as a diagram and can show its source", async () => {
    const user = userEvent.setup();
    const { container } = await show("```mermaid\nsequenceDiagram\n  Alice->>Bob: hello\n```");

    expect(await screen.findByRole("button", { name: "Show source" })).toBeInTheDocument();
    const svg = container.querySelector("svg.pele");
    expect(svg?.textContent).toContain("hello");

    await user.click(screen.getByRole("button", { name: "Show source" }));
    expect(container.querySelector("svg.pele")).toBeNull();
    expect(container.textContent).toContain("Alice->>Bob: hello");

    await user.click(screen.getByRole("button", { name: "Show diagram" }));
    expect(container.querySelector("svg.pele")).not.toBeNull();
  });

  it("falls back to the code block when the diagram does not parse", async () => {
    const { container } = await show("```mermaid\nsequenceDiagram\n  A->>: broken\n```");

    expect(
      await screen.findByText(
        "Couldn't draw this diagram: Parse error on line 2: Expecting 'ACTOR', got 'TXT'",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector("svg.pele")).toBeNull();
    expect(container.textContent).toContain("A->>: broken");
  });

  it("keeps a diagram that is still streaming in as code", async () => {
    const { container } = await show("```mermaid\nsequenceDiagram\n  Alice->>", true);
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));

    expect(screen.queryByText(/Couldn't draw this diagram/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Show source" })).toBeNull();
    expect(container.textContent).toContain("Alice->>");
  });
});
