import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
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
