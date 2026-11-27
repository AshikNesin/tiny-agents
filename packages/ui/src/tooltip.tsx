import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "./lib/utils";

function TooltipProvider({
  delay = 200,
  timeout = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delay={delay} timeout={timeout} {...props} />;
}

const SLIDE = { top: { y: 4 }, bottom: { y: -4 }, left: { x: 4 }, right: { x: -4 } } as const;
const ENTER = { type: "spring", duration: 0.08, bounce: 0 } as const;
const EXIT = { duration: 0.06 } as const;

function Tooltip({
  children,
  content,
  side = "right",
  className,
  open: openProp,
  defaultOpen,
  onOpenChange,
  delay,
  disableHoverablePopup,
  sideOffset = 6,
  ...props
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delay?: number;
  disableHoverablePopup?: boolean;
} & Omit<React.ComponentProps<typeof TooltipPrimitive.Positioner>, "side" | "className">) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen ?? false);
  const open = openProp ?? uncontrolled;
  const [mounted, setMounted] = React.useState(open);
  if (open && !mounted) setMounted(true);
  const reduceMotion = useReducedMotion() ?? false;
  const tipId = React.useId();

  React.useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setMounted(false), 160);
    return () => clearTimeout(id);
  }, [open]);

  const trigger = React.isValidElement(children) ? children : <span>{children}</span>;

  return (
    <TooltipPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setUncontrolled(next);
        onOpenChange?.(next);
      }}
      disableHoverablePopup={disableHoverablePopup}
    >
      <TooltipPrimitive.Trigger
        delay={delay}
        aria-describedby={open ? tipId : undefined}
        render={trigger}
      />
      {mounted && (
        <TooltipPrimitive.Portal keepMounted>
          <TooltipPrimitive.Positioner
            side={side}
            sideOffset={sideOffset}
            className="z-50"
            {...props}
          >
            <TooltipPrimitive.Popup
              id={tipId}
              role="tooltip"
              render={
                <motion.div
                  className={cn(
                    "rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-md",
                    className,
                  )}
                  initial={{ opacity: 0, ...SLIDE[side] }}
                  animate={{ opacity: open ? 1 : 0, x: 0, y: 0 }}
                  transition={reduceMotion ? { duration: 0 } : open ? ENTER : EXIT}
                  onAnimationComplete={() => {
                    if (!open) setMounted(false);
                  }}
                />
              }
            >
              {content}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      )}
    </TooltipPrimitive.Root>
  );
}

export { Tooltip, TooltipProvider };
