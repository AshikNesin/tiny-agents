import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import { useConfirm } from "@groot/ui/primitives";

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
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [when]);

  return null;
}
