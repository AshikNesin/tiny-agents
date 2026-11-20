"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";

import { cn } from "@groot/ui/lib/utils";

const METRICS = {
  default: { trackWidth: 34, trackHeight: 20, thumb: 16, hoverExtend: 2, pressExtend: 4 },
  sm: { trackWidth: 28, trackHeight: 16, thumb: 12, hoverExtend: 2, pressExtend: 3 },
} as const;
const OFFSET = 2;
const DRAG_DEAD_ZONE = 2;
const SPRING = { type: "spring", duration: 0.16, bounce: 0 } as const;

function Switch({
  className,
  size = "default",
  checked: checkedProp,
  defaultChecked,
  onCheckedChange,
  disabled,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerEnter,
  onPointerLeave,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultChecked ?? false);
  const checked = checkedProp ?? uncontrolled;
  const setChecked = (next: boolean) => {
    if (checkedProp === undefined) setUncontrolled(next);
    onCheckedChange?.(next);
  };

  const reduceMotion = useReducedMotion() ?? false;
  const m = METRICS[size];
  const travel = m.trackWidth - m.thumb - OFFSET * 2;
  const [hovered, setHovered] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);

  const width = pressed ? m.thumb + m.pressExtend : hovered ? m.thumb + m.hoverExtend : m.thumb;
  const height = pressed ? m.thumb - m.pressExtend : m.thumb;
  const restX = checked ? OFFSET + travel - (width - m.thumb) : OFFSET;

  const x = useMotionValue(restX);
  const mounted = React.useRef(false);
  const drag = React.useRef<{ startX: number; originX: number; active: boolean } | null>(null);
  const swallowClick = React.useRef(false);

  React.useEffect(() => {
    if (drag.current?.active) return;
    if (!mounted.current || reduceMotion) x.set(restX);
    else void animate(x, restX, SPRING);
    mounted.current = true;
  }, [restX, x, reduceMotion]);

  const dragBounds = () => ({
    min: OFFSET,
    max: m.trackWidth - OFFSET - (m.thumb + m.pressExtend),
  });

  const endPress = (commit: boolean) => {
    const state = drag.current;
    drag.current = null;
    setPressed(false);
    if (!state?.active) return;
    swallowClick.current = true;
    const { min, max } = dragBounds();
    const on = x.get() > (min + max) / 2;
    if (commit && on !== checked) setChecked(on);
    else void animate(x, restX, SPRING);
  };

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      checked={checked}
      onCheckedChange={setChecked}
      disabled={disabled}
      className={cn(
        "peer relative inline-flex shrink-0 touch-none rounded-full outline-none select-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      style={{ width: m.trackWidth, height: m.trackHeight }}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        if (e.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={(e) => {
        onPointerLeave?.(e);
        setHovered(false);
      }}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
        setPressed(true);
        swallowClick.current = false;
        drag.current = { startX: e.clientX, originX: x.get(), active: false };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        onPointerMove?.(e);
        const state = drag.current;
        if (!state) return;
        const delta = e.clientX - state.startX;
        if (!state.active) {
          if (Math.abs(delta) < DRAG_DEAD_ZONE) return;
          state.active = true;
        }
        const { min, max } = dragBounds();
        x.set(Math.max(min, Math.min(max, state.originX + delta)));
      }}
      onPointerUp={(e) => {
        onPointerUp?.(e);
        endPress(true);
      }}
      onPointerCancel={(e) => {
        onPointerCancel?.(e);
        endPress(false);
      }}
      onClick={(e) => {
        onClick?.(e);
        if (swallowClick.current) {
          swallowClick.current = false;
          e.preventDefault();
        }
      }}
      {...props}
    >
      <SwitchPrimitive.Thumb data-slot="switch-thumb" asChild>
        <motion.span
          className="pointer-events-none absolute top-0 left-0 block rounded-full bg-background shadow-sm dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground"
          initial={false}
          style={{ x }}
          animate={{ y: OFFSET + (m.thumb - height) / 2, width, height }}
          transition={mounted.current && !reduceMotion ? SPRING : { duration: 0 }}
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}

export { Switch };
