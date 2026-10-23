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
  /** Parent page for the phone back button (detail pages). */
  backTo?: string;
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
  backTo,
}: PageLayoutProps) {
  const subtitle =
    breadcrumb || description ? (
      <>
        {breadcrumb && <div className={description ? "mb-3" : undefined}>{breadcrumb}</div>}
        {description && <div className="text-muted-foreground text-sm">{description}</div>}
      </>
    ) : null;
  return (
    <PageContainer maxWidth={maxWidth} className={className}>
      <TopBar title={title} actions={actions} subtitle={subtitle} backTo={backTo}>
        {titleAdornment}
      </TopBar>
      <div className="mt-6 space-y-6">{children}</div>
    </PageContainer>
  );
}
