import type { ReactNode } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { cn } from "@groot/ui/lib/utils";
import { useUiStore } from "../../store/ui";

export function SidebarSection({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const folded = useUiStore((s) => s.foldedSections.includes(title));
  const toggleSection = useUiStore((s) => s.toggleSection);
  return (
    <section aria-label={title} className={cn("px-2.5 pb-3", className)}>
      <div className="group/heading flex h-8 items-center justify-between">
        <h2>
          <button
            type="button"
            aria-expanded={!folded}
            onClick={() => toggleSection(title)}
            className="text-fg-tertiary hover:text-foreground focus-visible:ring-sidebar-ring flex h-7 items-center gap-1 rounded-lg px-1.5 text-sm outline-none select-none focus-visible:ring-1"
          >
            {title}
            <ChevronDown
              aria-hidden
              className={cn("size-3.5 transition-transform", folded && "-rotate-90")}
            />
          </button>
        </h2>
        {action}
      </div>
      {!folded && children}
    </section>
  );
}

export function MoreRow({
  hidden,
  expanded,
  onToggle,
}: {
  hidden: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-sidebar-ring mt-0.5 flex h-9 w-full items-center gap-2.5 rounded-xl px-1.5 text-sm outline-none focus-visible:ring-1"
    >
      <span aria-hidden className="grid size-6 shrink-0 place-items-center">
        <MoreHorizontal className="size-4" />
      </span>
      {expanded ? "Less" : `More (${hidden})`}
    </button>
  );
}
