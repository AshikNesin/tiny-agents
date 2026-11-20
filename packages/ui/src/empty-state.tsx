import type { LucideIcon } from "lucide-react";
import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  variant?: "default" | "destructive";
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "default",
  className,
}: EmptyStateProps) {
  const destructive = variant === "destructive";

  return (
    <div
      className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}
    >
      <div
        className={cn(
          "mb-3 flex size-12 items-center justify-center rounded-full",
          destructive ? "bg-destructive/10" : "bg-muted",
        )}
      >
        <Icon
          className={cn("size-6", destructive ? "text-destructive" : "text-muted-foreground")}
        />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-4 flex items-center gap-2">{action}</div>}
    </div>
  );
}

type ErrorStateProps = Omit<EmptyStateProps, "variant" | "icon"> & {
  icon?: LucideIcon;
};

export function ErrorState({ icon = AlertCircle, title, ...props }: ErrorStateProps) {
  return <EmptyState icon={icon} title={title} variant="destructive" {...props} />;
}
