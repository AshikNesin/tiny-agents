import * as React from "react";
import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";

import { cn } from "./lib/utils";

function Label({ className, render, ...props }: useRender.ComponentProps<"label">) {
  return useRender({
    render:
      render ??
      ((labelProps) => (
        <label {...labelProps} htmlFor={(labelProps as React.ComponentProps<"label">).htmlFor}>
          {labelProps.children}
        </label>
      )),
    props: mergeProps<"label">(
      {
        "data-slot": "label",
        className: cn(
          "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
          className,
        ),
      } as React.ComponentProps<"label">,
      props,
    ),
  });
}

export { Label };
