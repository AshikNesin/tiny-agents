import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, Square } from "lucide-react";
import { Spinner } from "./ui/spinner";

export function ComposerSendIcon({ mode }: { mode: "send" | "stop" | "busy" }) {
  const reduceMotion = useReducedMotion() ?? false;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={mode}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={
          reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, transition: { duration: 0.06 } }
        }
        transition={{ type: "spring", duration: 0.08, bounce: 0 }}
        className="flex items-center justify-center leading-none"
      >
        {mode === "stop" ? (
          <Square className="size-3 fill-current" />
        ) : mode === "busy" ? (
          <Spinner className="size-4" aria-hidden />
        ) : (
          <ArrowUp className="size-4" />
        )}
      </motion.span>
    </AnimatePresence>
  );
}
