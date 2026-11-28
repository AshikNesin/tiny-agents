import { Badge } from "@groot/ui/badge";
import { cn } from "@groot/ui/lib/utils";
import type { StatusLabels, StatusTone } from "../../shared/machines/status-label";

const DANGER_TEXT = "text-[color-mix(in_oklch,var(--destructive)_65%,var(--foreground))]";

const STATUS_TONE: Record<StatusTone, { text: string; surface: string; dot: string }> = {
  neutral: { text: "text-muted-foreground", surface: "bg-muted/40", dot: "bg-muted-foreground" },
  strong: { text: "text-foreground", surface: "bg-muted", dot: "bg-foreground" },
  info: { text: "text-info", surface: "bg-info/10", dot: "bg-info" },
  success: { text: "text-success", surface: "bg-success/10", dot: "bg-success" },
  warning: { text: "text-warning", surface: "bg-warning/10", dot: "bg-warning" },
  danger: { text: DANGER_TEXT, surface: "bg-destructive/10", dot: "bg-destructive" },
  accent: { text: "text-primary", surface: "bg-primary/10", dot: "bg-primary" },
};

export function statusTextClass(tone: StatusTone): string {
  return STATUS_TONE[tone].text;
}

export function MachineStatusBadge<Status extends string>({
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
