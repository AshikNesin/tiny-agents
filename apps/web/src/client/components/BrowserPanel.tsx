/**
 * BrowserPanel (issue #24): the bot's browser viewport, live.
 *
 * The view is one <img> whose src is the MJPEG stream (JWT cookie
 * authorizes it, same as uploads). Takeover flips the server's driver flag;
 * while the human drives, mouse and key events are POSTed to the input
 * route and injected as real CDP input. The masked secret field sends
 * keystrokes only: the value is never held anywhere client-side beyond the
 * input element, never logged, never persisted.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, Keyboard, MousePointer2, RotateCcw, X } from "lucide-react";
import { Button } from "@groot/ui/button";
import { toast } from "sonner";
import { botsApi, type BrowserStatus } from "../lib/bots-api";
import type { Bot } from "../lib/bots-api";

export function BrowserPanel({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const humanDrives = status?.driver === "human";

  // Poll status lightly: the session starts lazily on the bot's first
  // browser tool call, so the panel mounts before a session may exist.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await botsApi.browserStatus(bot.id);
        if (alive) setStatus(s);
      } catch {
        /* panel stays on last known status */
      }
    };
    void tick();
    const timer = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [bot.id]);

  const setDriver = async (driver: "agent" | "human") => {
    try {
      await botsApi.browserDriver(bot.id, driver);
      setStatus((s) => (s ? { ...s, driver } : s));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to switch driver");
    }
  };

  // Coordinate translation: the 1280x800 frame is object-contained, so the
  // img box letterboxes it. Map through the rendered frame, not the box.
  const toViewport = useCallback(
    (clientX: number, clientY: number, el: HTMLElement | null = imgRef.current) => {
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      const scale = Math.min(rect.width / 1280, rect.height / 800);
      const offsetX = (rect.width - 1280 * scale) / 2;
      const offsetY = (rect.height - 800 * scale) / 2;
      return {
        x: Math.round((clientX - rect.left - offsetX) / scale),
        y: Math.round((clientY - rect.top - offsetY) / scale),
      };
    },
    [],
  );

  const onMouse = (event: React.MouseEvent) => {
    if (!humanDrives) return;
    void botsApi.browserInput(bot.id, {
      kind: "mouse",
      ...toViewport(event.clientX, event.clientY),
    });
  };
  const onWheel = (event: React.WheelEvent) => {
    if (!humanDrives) return;
    const { x, y } = toViewport(event.clientX, event.clientY);
    void botsApi.browserInput(bot.id, { kind: "scroll", x, y, deltaY: Math.round(event.deltaY) });
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!humanDrives) return;
    // Modified shortcuts (Ctrl/Cmd+…) are not text: swallow them rather
    // than sending the bare character into the page.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      event.preventDefault();
      return;
    }
    if (event.key.length === 1) {
      void botsApi.browserInput(bot.id, { kind: "key", key: event.key, text: event.key });
    } else if (
      /^(Enter|Tab|Escape|Backspace|Delete|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/.test(
        event.key,
      )
    ) {
      void botsApi.browserInput(bot.id, { kind: "key", key: event.key });
    } else {
      return;
    }
    event.preventDefault();
  };

  // Masked secret field: each keystroke goes straight into the page. The
  // element is readOnly so no copy of the secret exists in client state;
  // paste is forwarded as characters, never stored.
  const onSecretKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      event.preventDefault();
      return;
    }
    if (event.key.length === 1) {
      void botsApi.browserInput(bot.id, { kind: "key", key: event.key, text: event.key });
      event.preventDefault();
    } else if (
      event.key === "Enter" ||
      event.key === "Backspace" ||
      event.key === "Delete" ||
      event.key === "Tab"
    ) {
      void botsApi.browserInput(bot.id, { kind: "key", key: event.key });
      event.preventDefault();
    }
  };
  const onSecretPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    for (const ch of event.clipboardData.getData("text")) {
      void botsApi.browserInput(bot.id, { kind: "key", key: ch, text: ch });
    }
  };

  const resetProfile = async () => {
    try {
      await botsApi.browserResetProfile(bot.id);
      setStatus((s) => (s ? { ...s, active: false, url: null, driver: null } : s));
      toast.success("Browser profile wiped; the next session starts fresh.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset");
    }
  };

  return (
    <div
      className="bg-background fixed inset-0 z-40 flex flex-col md:static md:z-auto md:h-full md:w-[420px] md:shrink-0 md:border-l"
      data-testid="browser-panel"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MousePointer2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs text-muted-foreground" data-testid="browser-url">
          {status?.url ?? "starting…"}
        </span>
        <span
          className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
          data-testid="browser-driver"
        >
          {humanDrives ? "you drive" : `${bot.name} drives`}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onClose}
          aria-label="Close browser panel"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div
        className="relative flex-1 overflow-hidden"
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-testid="browser-viewport"
      >
        {status?.active ? (
          <img
            ref={imgRef}
            src={`/api/v1/bots/${bot.id}/browser/live`}
            alt="bot browser viewport"
            className="h-full w-full object-contain"
            onClick={onMouse}
            onWheel={onWheel}
            draggable={false}
          />
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Eye className="size-4" /> The browser opens when {bot.name} first uses it.
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-2">
        {humanDrives ? (
          <>
            <Keyboard className="size-3.5 text-muted-foreground" />
            <input
              type="password"
              onKeyDown={onSecretKey}
              onPaste={onSecretPaste}
              placeholder="type or paste — goes straight into the page"
              className="h-7 flex-1 rounded border bg-transparent px-2 text-xs"
              autoComplete="off"
              readOnly
              data-testid="browser-secret"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void setDriver("agent")}
              data-testid="browser-release"
            >
              Release to {bot.name}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => void setDriver("human")}
              disabled={!status?.active}
              data-testid="browser-takeover"
            >
              Take control
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void resetProfile()}
              title="Close and wipe the browser profile"
            >
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
