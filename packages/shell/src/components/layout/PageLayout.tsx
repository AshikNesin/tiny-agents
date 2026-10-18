import type { ReactNode } from "react";
import { TopBar } from "../TopBar";
import { PageContainer } from "./PageContainer";

interface PageLayoutProps {
  children: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Rendered above the title (e.g. a `Breadcrumb`). */
  breadcrumb?: ReactNode;
  /** Rendered inline after the title (e.g. a `StatusBadge`). */
  titleAdornment?: ReactNode;
  className?: string;
  maxWidth?: "full" | "7xl" | "6xl" | "5xl" | "4xl";
}

/**
 * Complete page layout: Grok-style TopBar (circular back, title, profile
 * circle) above a container with description, actions, and content.
 *
 * Every routed page should render through this (or `PageContainer` +
 * `TopBar`) so titles, max-widths, and header-to-content spacing stay
 * identical across the app.
 */
export function PageLayout({
  children,
  title,
  description,
  actions,
  breadcrumb,
  titleAdornment,
  className,
  maxWidth = "5xl",
}: PageLayoutProps) {
  return (
    <PageContainer maxWidth={maxWidth} className={className}>
      <TopBar title={title}>{titleAdornment}</TopBar>
      {breadcrumb && <div className="mb-4">{breadcrumb}</div>}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {description && <div className="text-muted-foreground text-sm">{description}</div>}
        </div>
        {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-8 space-y-6">{children}</div>
    </PageContainer>
  );
}
