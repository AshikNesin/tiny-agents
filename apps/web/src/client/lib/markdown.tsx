import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";

type ParagraphProps = ComponentProps<"p"> & { node?: unknown };

function tagOf(child: ReactNode): string | undefined {
  if (!isValidElement(child)) return undefined;
  const node = (child.props as { node?: { tagName?: string } }).node;
  return node?.tagName;
}

function MarkdownParagraph({ node: _node, children, ...props }: ParagraphProps) {
  const items = Children.toArray(children);
  const tags = items.map(tagOf);
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

export const markdownComponents = { p: MarkdownParagraph };
