import { describe, expect, it } from "vite-plus/test";
import { render } from "@testing-library/react";
import { markdownComponents } from "@/lib/markdown";

const P = markdownComponents.p;
/** A child as Streamdown renders it: the hast node rides along as a prop. */
const Img = (_: { node: { tagName: string } }) => <span data-streamdown="image-wrapper" />;

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
