/**
 * @vitest-environment jsdom
 *
 * Mention autocomplete overlay (issue #12): filtering, keyboard selection,
 * and close-on-Escape. The trigger rules (when the composer opens it) live
 * in lib/mentions and are covered by mentions.test.ts; this renders only
 * the popover itself, so no SSE store or router is needed.
 */
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  MentionAutocomplete,
  type MentionAutocompleteHandle,
  type MentionableBot,
} from "@/components/MentionAutocomplete";

const BOTS: MentionableBot[] = [
  { id: "b1", name: "Ada", description: "Loves proofs" },
  { id: "b2", name: "Grace", description: "Ships compilers" },
  { id: "b3", name: "Pi", description: "Math sidekick" },
];

function renderOverlay(props: Partial<Parameters<typeof MentionAutocomplete>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const handle = React.createRef<MentionAutocompleteHandle>();
  const { rerender } = render(
    <MentionAutocomplete
      ref={handle}
      bots={BOTS}
      query=""
      onSelect={onSelect}
      onClose={onClose}
      {...props}
    />,
  );
  // The composer owns focus, so keys reach the overlay through its handle.
  const press = (key: string) =>
    act(() => {
      expect(
        handle.current!.handleKeyDown(
          new KeyboardEvent("keydown", { key }) as unknown as React.KeyboardEvent,
        ),
      ).toBe(true);
    });
  return { onSelect, onClose, press, rerender, handle };
}

const options = () => screen.getAllByRole("option");

describe("MentionAutocomplete", () => {
  it("renders every row when the query is empty", () => {
    renderOverlay();
    expect(options()).toHaveLength(3);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Loves proofs")).toBeInTheDocument();
  });

  it("filters rows by prefix, case-insensitively", () => {
    renderOverlay({ query: "gr" });
    const rows = options();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Grace");
  });

  it("renders nothing when no name matches", () => {
    const { onClose } = renderOverlay({ query: "zz" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves the selection with the arrow keys and wraps", () => {
    const { press } = renderOverlay();
    const first = options()[0];
    expect(first).toHaveAttribute("aria-selected", "true");

    press("ArrowDown");
    press("ArrowDown");
    expect(options()[2]).toHaveAttribute("aria-selected", "true");

    // Wraps to the top.
    press("ArrowDown");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");

    // And back up.
    press("ArrowUp");
    expect(options()[2]).toHaveAttribute("aria-selected", "true");
  });

  it("resets the selection to the first row when the query changes", () => {
    const { press, rerender, handle } = renderOverlay();
    press("ArrowDown");
    expect(options()[1]).toHaveAttribute("aria-selected", "true");

    rerender(
      <MentionAutocomplete
        ref={handle}
        bots={BOTS}
        query="p"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("inserts the highlighted row on Enter and closes", () => {
    const { onSelect, onClose, press } = renderOverlay();
    press("ArrowDown");
    press("Enter");
    expect(onSelect).toHaveBeenCalledWith(BOTS[1]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("inserts with Tab too", () => {
    const { onSelect, press } = renderOverlay();
    press("Tab");
    expect(onSelect).toHaveBeenCalledWith(BOTS[0]);
  });

  it("closes on Escape without inserting", () => {
    const { onSelect, onClose, press } = renderOverlay();
    press("Escape");
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("inserts the clicked row", () => {
    const { onSelect, onClose } = renderOverlay();
    fireEvent.click(options()[2]);
    expect(onSelect).toHaveBeenCalledWith(BOTS[2]);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
