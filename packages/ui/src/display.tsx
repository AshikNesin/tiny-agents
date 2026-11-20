import type { ReactNode } from "react";

import { tableColumnHeaderClass } from "./table";
import { cn } from "./lib/utils";

interface DataFieldProps {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  valueClassName?: string;
}

export function DataField({ label, children, className, valueClassName }: DataFieldProps) {
  return (
    <div className={className}>
      <dt className={tableColumnHeaderClass}>{label}</dt>
      <dd className={cn("mt-1 text-sm text-foreground", valueClassName)}>{children}</dd>
    </div>
  );
}

interface DataFieldsProps {
  children: ReactNode;
  className?: string;
  columns?: 2 | 3 | 4;
}

export function DataFields({ children, className, columns }: DataFieldsProps) {
  const cols = columns
    ? {
        2: "grid-cols-2",
        3: "grid-cols-2 md:grid-cols-3",
        4: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
      }[columns]
    : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4";

  return <dl className={cn("grid gap-x-6 gap-y-4", cols, className)}>{children}</dl>;
}
