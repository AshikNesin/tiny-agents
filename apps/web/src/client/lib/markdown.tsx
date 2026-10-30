import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";

type ParagraphProps = ComponentProps<"p"> & { node?: unknown };

/** The hast tag name a rendered markdown child came from, when it has one. */
function tagOf(child: ReactNode): string | undefined {
  if (!isValidElement(child)) return undefined;
  const node = (child.props as { node?: { tagName?: string } }).node;
  return node?.tagName;
}

/**
 * Markdown paragraphs that can hold Streamdown's image wrapper. Streamdown
 * unwraps a paragraph whose only child is an image, but text next to an image
 * puts its `<div>` wrapper inside a `<p>` (invalid HTML, a React warning), so
 * such a paragraph renders as a `<div>` with the same props instead.
 */
function MarkdownParagraph({ node: _node, children, ...props }: ParagraphProps) {
  const items = Children.toArray(children);
  const tags = items.map(tagOf);
  // Streamdown's own unwrapping: a lone image or a fenced code block.
  if (items.length === 1 && tags[0] === "img") return <>{children}</>;
  if (
    items.length === 1 &&
    tags[0] === "code" &&
    isValidElement(items[0]) &&
    "data-block" in (items[0].props as object)
  ) {
    return <>{children}</>;
  }
  if (tags.includes("img")) return <div {...props}>{children}</div>;
  return <p {...props}>{children}</p>;
}

/** Streamdown component overrides shared by every chat markdown surface. */
export const markdownComponents = { p: MarkdownParagraph };
