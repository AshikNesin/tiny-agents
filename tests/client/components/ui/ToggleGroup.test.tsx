import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { ToggleGroup, ToggleGroupItem } from "@groot/ui/toggle-group";

describe("ToggleGroup", () => {
  it("marks the selected item checked when uncontrolled", async () => {
    render(
      <ToggleGroup defaultValue="ask" aria-label="Permission">
        <ToggleGroupItem value="allow">Allow</ToggleGroupItem>
        <ToggleGroupItem value="ask">Ask</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(screen.getByRole("radio", { name: "Ask" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "Allow" }));
    expect(screen.getByRole("radio", { name: "Allow" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Ask" })).toHaveAttribute("aria-checked", "false");
  });
});
