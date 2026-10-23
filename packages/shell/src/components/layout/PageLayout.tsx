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
      <TopBar title={title}>
        {titleAdornment}
        {/* Actions share the title row on desktop; on phones they wrap to
            a row of their own under it instead of squeezing beside a
            multi-line description. */}
        {actions && (
          <div className="order-last flex w-full flex-wrap items-center gap-2 md:order-none md:w-auto md:flex-nowrap">
            {actions}
          </div>
        )}
      </TopBar>
      {breadcrumb && <div className="mb-4">{breadcrumb}</div>}
      {description && <div className="text-muted-foreground mt-1 text-sm">{description}</div>}
      <div className="mt-6 space-y-6">{children}</div>
    </PageContainer>
  );
}
