import * as React from "react";
import { Loader2Icon } from "lucide-react";

import { cn } from "@groot/ui/lib/utils";

/**
 * Icon-sized inline spinner (an svg, `size-4` by default) for icon slots:
 * `TraceIcon` on a running step, a pending `Button`, a submit control.
 * For a whole loading surface use `LoadingState` / skeletons instead.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
