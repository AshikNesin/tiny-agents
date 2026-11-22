import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router-dom";

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

type AnchorProps = ComponentProps<"a"> & { node?: unknown };

function MarkdownAnchor({ node: _node, href, children, ...props }: AnchorProps) {
  if (typeof href === "string" && href.startsWith("/")) {
    return (
      <Link to={href} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

export const markdownComponents = { p: MarkdownParagraph, a: MarkdownAnchor };
