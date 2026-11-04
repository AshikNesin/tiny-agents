/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { SearchSelect } from "@/components/ui/search-select";

const options = [
  { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { value: "gpt-6", label: "GPT-6", keywords: ["openai"] },
];

describe("SearchSelect", () => {
  it("filters as you type and picks with Enter", async () => {
    const onValueChange = vi.fn();
    render(
      <SearchSelect
        label="Model"
        value="claude-opus-5-5"
        onValueChange={onValueChange}
        options={options}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Model" });
    expect(trigger).toHaveTextContent("Claude Opus 5.5");
    await userEvent.click(trigger);
    const search = await screen.findByPlaceholderText("Search…");
    await userEvent.type(search, "openai");
    expect(screen.queryByText("Claude Sonnet 5.5")).not.toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onValueChange).toHaveBeenCalledWith("gpt-6");
  });

  it("offers the typed query when nothing matches it exactly", async () => {
    const onUse = vi.fn();
    render(
      <SearchSelect
        label="Directory"
        value=""
        onValueChange={() => {}}
        options={[{ value: "/srv/app", label: "app" }]}
        emptyText="Type a full path."
        createOption={(q) =>
          q.startsWith("/") ? { key: "use", label: `Use “${q}”`, onSelect: onUse } : null
        }
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Directory" }));
    await userEvent.type(await screen.findByPlaceholderText("Search…"), "/tmp/x");
    expect(screen.queryByText("Type a full path.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Use “/tmp/x”"));
    expect(onUse).toHaveBeenCalledWith("/tmp/x");
  });
});
