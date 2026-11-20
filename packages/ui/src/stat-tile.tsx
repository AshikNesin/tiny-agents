import type { ReactNode } from "react";

import { tableColumnHeaderClass } from "./table";
import { cn } from "./lib/utils";
import { statClass } from "./typography";

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  className?: string;
  valueClassName?: string;
  onClick?: () => void;
  active?: boolean;
}

export function StatTile({
  label,
  value,
  icon,
  className,
  valueClassName,
  onClick,
  active,
}: StatTileProps) {
  const interactive = typeof onClick === "function";

  const content = (
    <>
      <span className={cn("flex items-center gap-1.5", tableColumnHeaderClass)}>
        {icon}
        {label}
      </span>
      <span className={cn(statClass, valueClassName)}>{value}</span>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex min-w-[7rem] flex-1 flex-col items-start gap-1 px-4 py-3 text-left",
          "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
          active && "bg-muted/60",
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return <div className={cn("flex flex-col gap-1", className)}>{content}</div>;
}
