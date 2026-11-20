import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./lib/utils";

export const metaLabelClass =
  "font-medium text-[11px] uppercase tracking-wider text-muted-foreground";

export const monoClass = "font-mono text-[0.9em]";

const titleClass = "font-heading text-base leading-snug font-medium";
export const h1Class = "text-xl font-semibold text-foreground sm:text-2xl";
export const statClass = "text-xl font-semibold tabular-nums";
export const displayClass = "text-3xl font-semibold leading-tight";

const textVariants = cva("text-foreground", {
  variants: {
    variant: {
      title: titleClass,
      body: "text-sm",
      meta: "text-xs text-muted-foreground",
      code: monoClass,
      stat: statClass,
      display: displayClass,
    },
    tone: {
      default: "",
      muted: "text-muted-foreground",
      primary: "text-primary",
      destructive: "text-destructive",
      success: "text-success",
      warning: "text-warning",
      info: "text-info",
      inverted: "text-primary-foreground",
    },
  },
  defaultVariants: { variant: "body", tone: "default" },
});

interface TextProps extends React.ComponentProps<"span">, VariantProps<typeof textVariants> {}

export function Text({ className, variant, tone, ...props }: TextProps) {
  return <span className={cn(textVariants({ variant, tone }), className)} {...props} />;
}
