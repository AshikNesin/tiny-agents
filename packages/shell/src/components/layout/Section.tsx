import type { ReactNode } from "react";

interface SectionProps {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function Section({ children, className, title, description, meta, actions }: SectionProps) {
  const hasHeader = Boolean(title || description || meta || actions);

  return (
    <div className={className}>
      {hasHeader && (
        <div className="mb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {title && <h2 className="text-sm font-medium text-foreground">{title}</h2>}
              {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
            </div>
            {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
          </div>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}
