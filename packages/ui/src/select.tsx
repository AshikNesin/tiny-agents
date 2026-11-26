"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";

import { cn } from "./lib/utils";
import { FluidHighlight } from "./motion";
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react";

type SelectItemEntry = { value: string; label: React.ReactNode };

function collectItems(node: React.ReactNode, out: SelectItemEntry[]) {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement<{ value?: string; children?: React.ReactNode }>(child)) return;
    if (child.type === SelectItem && typeof child.props.value === "string") {
      out.push({ value: child.props.value, label: child.props.children });
      return;
    }
    collectItems(child.props.children, out);
  });
  return out;
}

function Select({
  value,
  defaultValue,
  onValueChange,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof SelectPrimitive.Root<string>>,
  "value" | "defaultValue" | "onValueChange" | "items" | "multiple"
> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}) {
  const items = collectItems(children, []);
  return (
    <SelectPrimitive.Root<string>
      items={items}
      value={value === undefined ? undefined : value === "" ? null : value}
      defaultValue={defaultValue === "" ? null : defaultValue}
      onValueChange={(next) => onValueChange?.(next ?? "")}
      {...props}
    >
      {children}
    </SelectPrimitive.Root>
  );
}

function SelectGroup({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Group>, "className"> & {
  className?: string;
}) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1", className)}
      {...props}
    />
  );
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Trigger>, "className"> & {
  className?: string;
  size?: "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-full items-center justify-between gap-1.5 rounded-xl border border-input bg-transparent py-2 pr-2.5 pl-3 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-7 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={<ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />}
      />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  side = "bottom",
  align = "start",
  sideOffset = 4,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Popup>, "className"> & {
  className?: string;
  position?: "popper" | "item-aligned";
} & Pick<
    React.ComponentProps<typeof SelectPrimitive.Positioner>,
    "side" | "align" | "sideOffset"
  >) {
  const alignItemWithTrigger = position === "item-aligned";
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        className="z-50 outline-none"
        alignItemWithTrigger={alignItemWithTrigger}
        side={side}
        align={align}
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            "relative z-50 max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-closed:duration-100 data-closed:ease-in data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.97] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.97]",
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List className="relative isolate max-h-[inherit] scroll-my-1 overflow-y-auto p-1">
            <FluidHighlight />
            {children}
          </SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.GroupLabel>, "className"> & {
  className?: string;
}) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Item>, "className"> & {
  className?: string;
}) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-lg py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-selected:font-medium data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Separator>, "className"> & {
  className?: string;
}) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>, "className"> & {
  className?: string;
}) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>, "className"> & {
  className?: string;
}) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownArrow>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
