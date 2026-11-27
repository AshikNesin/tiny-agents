"use client";

import * as React from "react";
import { Menu as DropdownMenuPrimitive } from "@base-ui/react/menu";

import { cn } from "./lib/utils";
import { FluidHighlight } from "./motion";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

function DropdownMenu({
  onOpenChange,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Root>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <DropdownMenuPrimitive.Root
      onOpenChange={onOpenChange ? (open) => onOpenChange(open) : undefined}
      {...props}
    />
  );
}

type PositionerProps = Pick<
  React.ComponentProps<typeof DropdownMenuPrimitive.Positioner>,
  "side" | "align" | "sideOffset" | "alignOffset" | "collisionPadding"
>;

type PopupProps = Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Popup>, "className"> & {
  className?: string;
} & PositionerProps;

function onSelectToClick<
  E extends { defaultPrevented: boolean; preventBaseUIHandler?: () => void },
>(onSelect: ((event: E) => void) | undefined, onClick: ((event: E) => void) | undefined) {
  if (!onSelect) return onClick;
  return (event: E) => {
    onClick?.(event);
    onSelect(event);
    if (event.defaultPrevented) event.preventBaseUIHandler?.();
  };
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal {...props} />;
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  align = "start",
  side,
  sideOffset = 4,
  alignOffset,
  collisionPadding,
  children,
  ...props
}: PopupProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Positioner
        className="z-50 outline-none"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
      >
        <DropdownMenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-closed:duration-100 data-closed:ease-in data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-closed:overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.97] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.97]",
            className,
          )}
          {...props}
        >
          <FluidHighlight />
          {children}
        </DropdownMenuPrimitive.Popup>
      </DropdownMenuPrimitive.Positioner>
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

type ItemClickEvent = Parameters<
  NonNullable<React.ComponentProps<typeof DropdownMenuPrimitive.Item>["onClick"]>
>[0];

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  onSelect,
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Item>, "className"> & {
  className?: string;
  inset?: boolean;
  variant?: "default" | "destructive";
  onSelect?: (event: ItemClickEvent) => void;
}) {
  return (
    <DropdownMenuPrimitive.Item
      onClick={onSelectToClick(onSelect, onClick)}
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-default items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>, "className"> & {
  className?: string;
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-lg py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <DropdownMenuPrimitive.CheckboxItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>, "className"> & {
  className?: string;
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-lg py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <DropdownMenuPrimitive.RadioItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<"div"> & {
  inset?: boolean;
}) {
  return (
    <div
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Separator>, "className"> & {
  className?: string;
}) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs font-medium text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubmenuRoot>) {
  return <DropdownMenuPrimitive.SubmenuRoot {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.SubmenuTrigger>, "className"> & {
  className?: string;
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </DropdownMenuPrimitive.SubmenuTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  side = "right",
  align = "start",
  sideOffset = 2,
  alignOffset,
  collisionPadding,
  children,
  ...props
}: PopupProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Positioner
        className="z-50 outline-none"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
      >
        <DropdownMenuPrimitive.Popup
          data-slot="dropdown-menu-sub-content"
          className={cn(
            "relative isolate z-50 min-w-[96px] origin-(--transform-origin) overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-closed:duration-100 data-closed:ease-in data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.97] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.97]",
            className,
          )}
          {...props}
        >
          <FluidHighlight />
          {children}
        </DropdownMenuPrimitive.Popup>
      </DropdownMenuPrimitive.Positioner>
    </DropdownMenuPrimitive.Portal>
  );
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
