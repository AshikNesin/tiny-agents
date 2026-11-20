import { cn } from "./lib/utils";

interface LoadingSpinnerProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASSES = {
  sm: "size-4 border-2",
  md: "size-8 border-2",
  lg: "size-12 border-3",
} as const;

export function LoadingSpinner({ className, size = "md" }: LoadingSpinnerProps) {
  return (
    <output
      className={cn(
        "animate-spin rounded-full border-muted border-t-foreground",
        SIZE_CLASSES[size],
        className,
      )}
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </output>
  );
}

export function LoadingState({
  text = "Loading...",
  size = "lg",
  className,
}: {
  text?: string;
  size?: LoadingSpinnerProps["size"];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12", className)}>
      <LoadingSpinner size={size} />
      <p className="mt-4 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
