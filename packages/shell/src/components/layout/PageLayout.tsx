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
  breadcrumb?: ReactNode;
  titleAdornment?: ReactNode;
  className?: string;
  maxWidth?: "full" | "7xl" | "6xl" | "5xl" | "4xl";
  backTo?: string;
  navButton?: boolean;
}

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
        {actions && (
          <div
            className={cn(
              "col-start-2 row-start-1 flex flex-shrink-0 items-center gap-2 md:row-span-2",
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
