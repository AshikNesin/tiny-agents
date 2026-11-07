import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vite-plus/test";
import { Breadcrumbs } from "@groot/ui/breadcrumb";

describe("Breadcrumbs", () => {
  it("renders one flat list: items, separators between them, the page current", () => {
    const { container } = render(
      <Breadcrumbs page="echo">
        <a href="/connections">Connections</a>
        <a href="/connections/c1">Weather</a>
      </Breadcrumbs>,
    );

    const nav = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(container.querySelectorAll("nav")).toHaveLength(1);
    expect(nav.querySelectorAll("ol")).toHaveLength(1);
    const items = within(nav).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Connections", "Weather", "echo"]);
    expect(nav.querySelectorAll('li[role="presentation"]')).toHaveLength(2);
    expect(nav.querySelectorAll("li li")).toHaveLength(0);
    expect(within(items[2]).getByText("echo")).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Weather" })).toHaveAttribute(
      "href",
      "/connections/c1",
    );
  });

  it("without a page, the last link ends the trail with no trailing separator", () => {
    render(
      <Breadcrumbs>
        <button type="button" aria-label="Go to root folder" />
      </Breadcrumbs>,
    );

    const nav = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(within(nav).getAllByRole("listitem")).toHaveLength(1);
    expect(nav.querySelectorAll('li[role="presentation"]')).toHaveLength(0);
    expect(nav.querySelector("[aria-current]")).toBeNull();
  });
});
