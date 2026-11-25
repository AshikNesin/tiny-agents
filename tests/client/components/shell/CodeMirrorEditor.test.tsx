/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { CodeMirrorEditor } from "@groot/shell/components/CodeMirrorEditor";

vi.mock("@uiw/react-codemirror", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

describe("CodeMirrorEditor when its chunks fail to load", () => {
  it("falls back to a plain, still editable text field", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CodeMirrorEditor value="{}" onChange={onChange} height="200px" />);

    const field = await screen.findByRole("textbox", { name: "JSON" });
    expect(field).toHaveValue("{}");
    await user.type(field, " ");
    expect(onChange).toHaveBeenLastCalledWith("{} ");
  });

  it("stays read-only when the editor is not editable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<CodeMirrorEditor value="[]" editable={false} />);
    expect(await screen.findByRole("textbox", { name: "JSON" })).toHaveAttribute("readonly");
  });
});
