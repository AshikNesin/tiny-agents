import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@groot/ui/lib/utils";

export function ComposerChip({
  icon,
  label,
  tone,
  onRemove,
  removeLabel,
}: {
  icon: ReactNode;
  label: string;
  tone?: "destructive";
  onRemove(): void;
  removeLabel: string;
}) {
  return (
    <span
      className={cn(
        "bg-muted flex items-center gap-1 rounded-full py-0.5 pr-0.5 pl-2 text-xs",
        tone === "destructive" && "text-destructive",
      )}
    >
      {icon}
      <span className="max-w-40 truncate">{label}</span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="text-muted-foreground hover:bg-background hover:text-foreground rounded-full p-0.5"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
