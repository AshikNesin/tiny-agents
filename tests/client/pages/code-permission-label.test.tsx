/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { PermissionPicker } from "@/pages/code/controls";

describe("Code's permission chip", () => {
  it("calls never asking YOLO, the word chat uses", () => {
    render(
      <PermissionPicker
        modes={["default", "acceptEdits", "plan", "bypassPermissions"]}
        value="bypassPermissions"
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("code-permission")).toHaveTextContent("YOLO");
  });
});
