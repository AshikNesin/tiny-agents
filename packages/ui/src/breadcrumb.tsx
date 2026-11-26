import * as React from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";

import { cn } from "./lib/utils";
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";

function Breadcrumb({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav aria-label="breadcrumb" data-slot="breadcrumb" className={cn(className)} {...props} />
  );
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        "flex flex-wrap items-center gap-1.5 text-sm wrap-break-word text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

function BreadcrumbLink({ className, render, ...props }: useRender.ComponentProps<"a">) {
  return useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(
      {
        "data-slot": "breadcrumb-link",
        className: cn("transition-colors hover:text-foreground", className),
      } as React.ComponentProps<"a">,
      props,
    ),
  });
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      aria-current="page"
      className={cn("font-normal text-foreground", className)}
      {...props}
    />
  );
}

function BreadcrumbSeparator({ children, className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRightIcon />}
    </li>
  );
}

function BreadcrumbEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn("flex size-5 items-center justify-center [&>svg]:size-4", className)}
      {...props}
    >
      <MoreHorizontalIcon />
      <span className="sr-only">More</span>
    </span>
  );
}

type BreadcrumbLinks = React.ReactElement | false | null | undefined | readonly BreadcrumbLinks[];

function crumbLinks(children: BreadcrumbLinks, prefix = ""): React.ReactElement[] {
  return React.Children.toArray(children)
    .filter(React.isValidElement<{ children?: BreadcrumbLinks }>)
    .flatMap((link) =>
      link.type === React.Fragment
        ? crumbLinks(link.props.children, `${prefix}${link.key}`)
        : [
            <BreadcrumbItem key={`${prefix}${link.key}`}>
              <BreadcrumbLink render={link} />
            </BreadcrumbItem>,
          ],
    );
}

function Breadcrumbs({ children, page }: { children?: BreadcrumbLinks; page?: React.ReactNode }) {
  const items = crumbLinks(children);
  if (page != null && typeof page !== "boolean") {
    items.push(
      <BreadcrumbItem key="page">
        <BreadcrumbPage>{page}</BreadcrumbPage>
      </BreadcrumbItem>,
    );
  }
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.flatMap((item, index) =>
          index === 0 ? [item] : [<BreadcrumbSeparator key={`separator${item.key}`} />, item],
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export {
  Breadcrumbs,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
};
