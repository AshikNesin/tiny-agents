export type StatusTone =
  | "neutral"
  | "strong"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent";

export interface StatusLabel {
  label: string;
  tone: StatusTone;
}

export type StatusLabels<Status extends string> = Record<Status, StatusLabel>;
