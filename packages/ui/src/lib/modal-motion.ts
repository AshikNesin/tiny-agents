import { useEffect, useState } from "react";
import { useReducedMotion, type Transition } from "motion/react";

/**
 * Spring tiers and the deferred-unmount presence the modal primitives animate
 * with, adapted from Fluid Functionalism's springs
 * (https://www.fluidfunctionalism.com/docs/motion): critically damped `moderate`
 * for short travel, a slightly bouncy `slow` for panels. Exits run faster than
 * entrances so a closing surface clears before the next one lands.
 */
export const spring = {
  moderate: {
    type: "spring",
    duration: 0.16,
    bounce: 0,
    exit: { duration: 0.12 },
  },
  slow: {
    type: "spring",
    duration: 0.24,
    bounce: 0.12,
    exit: { duration: 0.16 },
  },
} as const;

type Tier = (typeof spring)[keyof typeof spring];

/** Safety buffer past a tier's exit before the portal is force-unmounted. */
const exitFallbackMs = (tier: Tier) => Math.round(tier.exit.duration * 1000) + 100;

/**
 * Keeps a modal surface mounted through its exit animation. `mounted` turns
 * true in the render that opens it (so the portal and `open` land in one
 * commit) and false once the exit completes — on `onExitComplete`, or after a
 * timer, because rAF-driven animations stall in throttled background tabs and
 * would otherwise leave an invisible overlay (and the scroll lock) in place.
 * Under reduced motion the transition is instant.
 */
export function useModalPresence(open: boolean, tier: Tier = spring.slow) {
  const reduceMotion = useReducedMotion() ?? false;
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setMounted(false), reduceMotion ? 0 : exitFallbackMs(tier));
    return () => clearTimeout(id);
  }, [open, reduceMotion, tier]);

  const transition: Transition = reduceMotion
    ? { duration: 0 }
    : open
      ? { type: tier.type, duration: tier.duration, bounce: tier.bounce }
      : { duration: tier.exit.duration, ease: [0.4, 0, 1, 1] };

  return {
    mounted,
    transition,
    onExitComplete: () => {
      if (!open) setMounted(false);
    },
  };
}

/** The dimmed backdrop behind a modal panel. */
export const overlayClass = "fixed inset-0 isolate z-50 bg-black/40 dark:bg-black/70";

/**
 * Panel widths (each capped at the viewport less a 1rem gutter per side):
 * `sm` 400px, the default; `md` 480px; `lg` 540px; `xl` 880px, the canvas for
 * composed layouts. A `sm:max-w-*` class still overrides it from 640px up.
 */
export const dialogSizes = {
  sm: "max-w-[400px]",
  md: "max-w-[480px]",
  lg: "max-w-[540px]",
  xl: "max-w-[880px]",
} as const;

/** Base panel classes, shared by the dialog and the alert dialog. */
export const dialogPanelClass =
  "fixed left-1/2 z-50 flex w-[calc(100%-2rem)] flex-col gap-5 rounded-3xl bg-popover p-6 text-sm text-popover-foreground shadow-2xl shadow-black/10 ring-1 ring-foreground/10 outline-none";

export function panelPlacement(position: "center" | "top") {
  return position === "top"
    ? "top-[12dvh] max-h-[calc(88dvh-1rem)]"
    : "top-1/2 max-h-[calc(100dvh-2rem)]";
}

/** Motion targets for the panel: centered panels translate by half their height. */
export function panelMotion(open: boolean, position: "center" | "top") {
  const y = position === "top" ? 0 : "-50%";
  return {
    initial: { opacity: 0, scale: 0.97, x: "-50%", y },
    animate: { opacity: open ? 1 : 0, scale: open ? 1 : 0.97, x: "-50%", y },
  };
}
