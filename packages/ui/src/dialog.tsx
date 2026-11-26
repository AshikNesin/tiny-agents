"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { motion } from "motion/react";

import { cn } from "./lib/utils";
import { useModalPresence } from "./motion";
import { Button } from "./button";
import { XIcon } from "lucide-react";

const overlayClass = "fixed inset-0 isolate z-50 bg-black/40 dark:bg-black/70";

const dialogSizes = {
  sm: "max-w-[400px]",
  md: "max-w-[480px]",
  lg: "max-w-[540px]",
  xl: "max-w-[880px]",
} as const;

const dialogPanelClass =
  "fixed left-1/2 z-50 flex w-[calc(100%-2rem)] flex-col gap-5 rounded-3xl bg-popover p-6 text-sm text-popover-foreground shadow-2xl shadow-black/10 ring-1 ring-foreground/10 outline-none";

function panelPlacement(position: "center" | "top") {
  return position === "top"
    ? "top-[12dvh] max-h-[calc(88dvh-1rem)]"
    : "top-1/2 max-h-[calc(100dvh-2rem)]";
}

function panelMotion(open: boolean, position: "center" | "top") {
  const y = position === "top" ? 0 : "-50%";
  return {
    initial: { opacity: 0, scale: 0.97, x: "-50%", y },
    animate: { opacity: open ? 1 : 0, scale: open ? 1 : 0.97, x: "-50%", y },
  };
}

const DialogOpenContext = React.createContext(false);
const DialogPointerDismissContext = React.createContext<{ current: boolean }>({ current: true });

function Dialog({
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Root>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
  const open = controlledOpen ?? uncontrolledOpen;
  const pointerDismiss = React.useRef(true);
  const handleOpenChange = (next: boolean, details: DialogPrimitive.Root.ChangeEventDetails) => {
    if (!next && details.reason === "outside-press" && !pointerDismiss.current) {
      details.cancel();
      return;
    }
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  return (
    <DialogOpenContext.Provider value={open}>
      <DialogPointerDismissContext.Provider value={pointerDismiss}>
        <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange} {...props} />
      </DialogPointerDismissContext.Provider>
    </DialogOpenContext.Provider>
  );
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        overlayClass,
        "duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = "sm",
  position = "center",
  dismissOnOutsideClick = true,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Popup>, "render" | "className"> & {
  className?: string;
  showCloseButton?: boolean;
  dismissOnOutsideClick?: boolean;
  size?: keyof typeof dialogSizes;
  position?: "center" | "top";
}) {
  const open = React.useContext(DialogOpenContext);
  const pointerDismiss = React.useContext(DialogPointerDismissContext);
  const { mounted, transition, onExitComplete } = useModalPresence(open);
  React.useEffect(() => {
    pointerDismiss.current = dismissOnOutsideClick;
  }, [pointerDismiss, dismissOnOutsideClick]);

  if (!mounted) return null;

  return (
    <DialogPortal keepMounted>
      <DialogPrimitive.Backdrop
        data-slot="dialog-overlay"
        render={
          <motion.div
            className={overlayClass}
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
            transition={transition}
          />
        }
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        {...props}
        render={
          <motion.div
            className={cn(dialogPanelClass, panelPlacement(position), dialogSizes[size], className)}
            {...panelMotion(open, position)}
            transition={transition}
            onAnimationComplete={onExitComplete}
          />
        }
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" className="absolute top-4 right-4" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("-mx-6 -my-1 min-h-0 flex-1 overflow-y-auto px-6 py-1", className)}
      {...props}
    />
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex shrink-0 flex-col gap-2", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
