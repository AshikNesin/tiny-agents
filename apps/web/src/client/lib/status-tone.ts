import type { StatusTone } from "../../shared/machines/status-label";

const DANGER_TEXT = "text-[color-mix(in_oklch,var(--destructive)_65%,var(--foreground))]";

export const STATUS_TONE: Record<StatusTone, { text: string; surface: string; dot: string }> = {
  neutral: { text: "text-muted-foreground", surface: "bg-muted/40", dot: "bg-muted-foreground" },
  strong: { text: "text-foreground", surface: "bg-muted", dot: "bg-foreground" },
  info: { text: "text-info", surface: "bg-info/10", dot: "bg-info" },
  success: { text: "text-success", surface: "bg-success/10", dot: "bg-success" },
  warning: { text: "text-warning", surface: "bg-warning/10", dot: "bg-warning" },
  danger: { text: DANGER_TEXT, surface: "bg-destructive/10", dot: "bg-destructive" },
  accent: { text: "text-primary", surface: "bg-primary/10", dot: "bg-primary" },
};
