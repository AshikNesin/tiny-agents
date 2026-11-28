import { Badge } from "@groot/ui/badge";
import { cn } from "@groot/ui/lib/utils";
import type { StatusLabels } from "../../shared/machines/status-label";
import { STATUS_TONE } from "../lib/status-tone";

export function StatusBadge<Status extends string>({
  status,
  labels,
  plain = false,
  className,
}: {
  status: Status;
  labels: StatusLabels<Status>;
  plain?: boolean;
  className?: string;
}) {
  const { label, tone } = labels[status];
  const look = STATUS_TONE[tone];
  if (plain) return <span className={cn(look.text, className)}>{label}</span>;
  return (
    <Badge variant="secondary" className={cn(look.surface, look.text, className)}>
      <span className={cn("size-1.5 rounded-full", look.dot)} />
      {label}
    </Badge>
  );
}
