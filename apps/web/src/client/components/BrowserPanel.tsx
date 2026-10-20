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
  const [secret, setSecret] = useState("");
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

  // Coordinate translation: displayed width -> 1280-wide viewport.
  const toViewport = useCallback((event: React.MouseEvent) => {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    const scale = 1280 / rect.width;
    return {
      x: Math.round((event.clientX - rect.left) * scale),
      y: Math.round((event.clientY - rect.top) * scale),
    };
  }, []);

  const onMouse = (event: React.MouseEvent) => {
    if (!humanDrives) return;
    void botsApi.browserInput(bot.id, { kind: "mouse", ...toViewport(event) });
  };
  const onWheel = (event: React.WheelEvent) => {
    if (!humanDrives) return;
    void botsApi.browserInput(bot.id, {
      kind: "scroll",
      ...toViewport(event),
      deltaY: Math.round(event.deltaY),
    });
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!humanDrives) return;
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

  // Masked secret field: each character goes straight into the page.
  const onSecretKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key.length === 1) {
      void botsApi.browserInput(bot.id, { kind: "key", key: event.key, text: event.key });
      event.preventDefault();
    } else if (event.key === "Enter") {
      void botsApi.browserInput(bot.id, { kind: "key", key: "Enter" });
      event.preventDefault();
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
      className="bg-background fixed inset-0 z-40 flex flex-col md:static md:z-auto md:w-[420px] md:shrink-0 md:border-l"
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
              value={secret}
              onChange={(e) => setSecret(e.target.value.slice(-1) && e.target.value.slice(0, 64))}
              onKeyDown={onSecretKey}
              placeholder="type here — goes straight into the page"
              className="h-7 flex-1 rounded border bg-transparent px-2 text-xs"
              autoComplete="off"
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
