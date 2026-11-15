import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Menu } from "lucide-react";
import { Button } from "@groot/ui/button";
import { h1Class } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import { useShellConfig } from "../../lib/shell-config";
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
  /**
   * Parent page (detail pages). Phones show a back button to it instead of
   * the menu button.
   */
  backTo?: string;
  /**
   * The phone menu button that opens the app's sidebar drawer. Off for a
   * full-page screen that brings its own way back (Settings), where there is
   * no drawer to open.
   */
  navButton?: boolean;
}

/**
 * A routed page: max-width container, header (title, description, actions)
 * and content.
 *
 * Every routed page renders through this so titles, max-widths and
 * header-to-content spacing stay identical across the app; it owns the one
 * sanctioned `<h1>`. Detail pages that need a breadcrumb trail or a status
 * pill beside the title use the `breadcrumb` / `titleAdornment` slots.
 *
 * tiny-agents: the app renders its own desktop sidebar, so phones open it
 * as a drawer from a menu button here (`ShellConfig.openNav`); a page that
 * sets `backTo` shows a back button to its parent instead. Both are
 * phone-only (`md:hidden`); desktop chrome belongs to the app's sidebar.
 *
 * @example
 * ```tsx
 * <PageLayout
 *   title="Dashboard"
 *   description="Overview of your finances"
 *   actions={<Button>Action</Button>}
 * >
 *   <Card>Content here</Card>
 * </PageLayout>
 * ```
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
  navButton = true,
}: PageLayoutProps) {
  const navigate = useNavigate();
  const { openNav } = useShellConfig();
  return (
    <PageContainer maxWidth={maxWidth} className={className}>
      {breadcrumb && <div className="mb-4">{breadcrumb}</div>}
      {/* A grid, so the actions share the title's row but never the
          description's: on a phone the description keeps the full width
          instead of wrapping into a narrow column beside the buttons. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4">
        <div className="col-start-1 row-start-1 min-w-0">
          <div className="flex min-h-9 items-center gap-2.5">
            {backTo ? (
              <Button
                variant="outline"
                size="icon"
                className="-ml-2 rounded-full md:hidden"
                onClick={() => navigate(backTo)}
                aria-label="Back"
              >
                <ArrowLeft className="size-5" />
              </Button>
            ) : openNav && navButton ? (
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 md:hidden"
                onClick={openNav}
                aria-label="Open menu"
              >
                <Menu className="size-5" />
              </Button>
            ) : null}
            <h1 className={cn("truncate", h1Class)}>{title}</h1>
            {titleAdornment}
          </div>
        </div>
        {description && (
          <div className="col-span-2 row-start-2 mt-1 text-sm text-muted-foreground md:col-span-1">
            {description}
          </div>
        )}
        {/* After the description in reading order; placed beside the title. */}
        {actions && (
          <div
            className={cn(
              "col-start-2 row-start-1 flex flex-shrink-0 items-center gap-2 md:row-span-2",
              // A detail page's title is a name (often long) and its actions
              // several: on a phone they get a row of their own under the
              // description, so the title is not cut to a few letters.
              backTo && "max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-3 max-sm:mt-3",
            )}
          >
            {actions}
          </div>
        )}
      </div>
      <div className="mt-8 space-y-6">{children}</div>
    </PageContainer>
  );
}
