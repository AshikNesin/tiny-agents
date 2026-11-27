import { describe, expect, it } from "vite-plus/test";
import { fireEvent, render, screen } from "@testing-library/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@groot/ui/tabs";

describe("Tabs in tests", () => {
  it("unmounts the old panel in the same act as the switch", () => {
    render(
      <Tabs defaultValue="write">
        <TabsList>
          <TabsTrigger value="write">Write</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent value="write">Write panel</TabsContent>
        <TabsContent value="preview">Preview panel</TabsContent>
      </Tabs>,
    );
    const preview = screen.getByRole("tab", { name: "Preview" });
    fireEvent.pointerDown(preview, { button: 0 });
    fireEvent.mouseDown(preview, { button: 0 });
    fireEvent.click(preview);
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.queryByText("Write panel")).toBeNull();
  });
});
