import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import { useConfirm } from "@groot/ui/primitives";

/**
 * Holds a page while `when` is true (unsaved edits): leaving in the app
 * (a link, the palette, browser back) asks to discard first, and closing or
 * reloading the tab gets the browser's own "leave site?" prompt.
 */
export function LeaveGuard({ when }: { when: boolean }) {
  const confirm = useConfirm();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirm({
      title: "Discard unsaved changes?",
      description: "Your edits on this page haven't been saved.",
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
      destructive: true,
    }).then((discard) => (discard ? blocker.proceed() : blocker.reset()));
  }, [blocker, confirm]);

  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers only prompt when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [when]);

  return null;
}
