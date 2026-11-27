"use client";

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { motion } from "motion/react";

import { cn } from "../lib/utils";
import { useModalPresence } from "../motion";

const overlayClass = "fixed inset-0 isolate z-50 bg-black/40 dark:bg-black/70";
const panelClass =
  "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[400px] flex-col gap-5 rounded-3xl bg-popover p-6 text-sm text-popover-foreground shadow-2xl shadow-black/10 ring-1 ring-foreground/10 outline-none";
const panelInitial = { opacity: 0, scale: 0.97, x: "-50%", y: "-50%" };
const panelAnimate = (open: boolean) => ({
  opacity: open ? 1 : 0,
  scale: open ? 1 : 0.97,
  x: "-50%",
  y: "-50%",
});
import { Button, type ButtonProps } from "../button";

const AlertDialogOpenContext = React.createContext(false);

function AlertDialog({
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  ...props
}: Omit<React.ComponentProps<typeof AlertDialogPrimitive.Root>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
  const open = controlledOpen ?? uncontrolledOpen;
  const handleOpenChange = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  return (
    <AlertDialogOpenContext.Provider value={open}>
      <AlertDialogPrimitive.Root open={open} onOpenChange={handleOpenChange} {...props} />
    </AlertDialogOpenContext.Provider>
  );
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogPortal({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Backdrop>) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        overlayClass,
        "duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof AlertDialogPrimitive.Popup>, "render" | "className"> & {
  className?: string;
}) {
  const open = React.useContext(AlertDialogOpenContext);
  const { mounted, transition, onExitComplete } = useModalPresence(open);
  if (!mounted) return null;
  return (
    <AlertDialogPortal keepMounted>
      <AlertDialogPrimitive.Backdrop
        data-slot="alert-dialog-overlay"
        render={
          <motion.div
            className={overlayClass}
            initial={{ opacity: 0 }}
            animate={{ opacity: open ? 1 : 0 }}
            transition={transition}
          />
        }
      />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        {...props}
        render={
          <motion.div
            className={cn(panelClass, className)}
            initial={panelInitial}
            animate={panelAnimate(open)}
            transition={transition}
            onAnimationComplete={onExitComplete}
          />
        }
      >
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex shrink-0 flex-col gap-2", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogAction({ className, ...props }: ButtonProps) {
  return <AlertDialogPrimitive.Close render={<Button className={cn(className)} {...props} />} />;
}

function AlertDialogCancel({ className, ...props }: ButtonProps) {
  return (
    <AlertDialogPrimitive.Close
      render={<Button variant="outline" className={cn(className)} {...props} />}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
