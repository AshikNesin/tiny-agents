import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

const FOCUS = /^(approval|question|takeover):\d+$/;
/** How long to wait for the card to render (the chat stream loads first). */
const WAIT_MS = 10_000;

/**
 * `/chats/:botId?focus=approval:<taskId>` (push notification links): scroll
 * the waiting card into view once the chat renders it, then drop the param.
 */
export function useFocusParam(): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const focus = searchParams.get("focus");

  useEffect(() => {
    if (!focus) return;
    const clear = () => {
      const next = new URLSearchParams(searchParams);
      next.delete("focus");
      setSearchParams(next, { replace: true });
    };
    if (!FOCUS.test(focus)) {
      clear();
      return;
    }
    const scroll = () => {
      const target = document.querySelector<HTMLElement>(`[data-waiting="${focus}"]`);
      if (!target) return false;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.querySelector<HTMLElement>("button, [tabindex]")?.focus({ preventScroll: true });
      return true;
    };
    if (scroll()) {
      clear();
      return;
    }
    const observer = new MutationObserver(() => {
      if (!scroll()) return;
      observer.disconnect();
      window.clearTimeout(timeout);
      clear();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // The call may have been answered already: give up quietly.
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      clear();
    }, WAIT_MS);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [focus, searchParams, setSearchParams]);
}
