import { describe, expect, it } from "vite-plus/test";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { markdownComponents } from "@/lib/markdown";

const P = markdownComponents.p;
const Img = ({ node }: { node: { tagName: string } }) => (
  <span data-streamdown="image-wrapper" data-tag={node.tagName} />
);

describe("markdownComponents.p", () => {
  it("renders text next to an image as a div, never a div inside a p", () => {
    const { container } = render(
      <P>
        See <Img node={{ tagName: "img" }} /> here
      </P>,
    );
    expect(container.querySelector("p")).toBeNull();
    expect(container.firstElementChild?.tagName).toBe("DIV");
  });

  it("unwraps a lone image like Streamdown does", () => {
    const { container } = render(
      <P>
        <Img node={{ tagName: "img" }} />
      </P>,
    );
    expect(container.firstElementChild?.getAttribute("data-streamdown")).toBe("image-wrapper");
  });

  it("keeps plain paragraphs as paragraphs", () => {
    const { container } = render(<P>Just text.</P>);
    expect(container.querySelector("p")?.textContent).toBe("Just text.");
  });
});

describe("markdownComponents.a", () => {
  const A = markdownComponents.a!;

  it("renders a same-app path as a react-router link", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <A href="/code/t/c0mws54j">thread</A>
      </MemoryRouter>,
    );
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("/code/t/c0mws54j");
  });

  it("keeps external URLs as plain anchors", () => {
    const { container } = render(
      <MemoryRouter>
        <A href="https://example.com/x">web</A>
      </MemoryRouter>,
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/x");
  });

  it("navigates client-side on click without a full page load", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<A href="/code/t/abc">thread</A>} />
          <Route path="/code/t/:threadId" element={<span>workspace</span>} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(container.querySelector("a")!);
    expect(container.textContent).toContain("workspace");
  });
});
