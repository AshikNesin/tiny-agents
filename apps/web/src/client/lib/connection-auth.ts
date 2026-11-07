/**
 * Signing in to an MCP connection (OAuth), end to end: the popup opens in
 * the click that asked for it (browsers block one opened after an await),
 * is pointed at the authorization page once the server names it, and the
 * callback page's completion message reaches whoever is waiting for it.
 * The add dialog and the connection page both go through here.
 */
import { connectionsApi } from "./connections-api";

/** A window opened for the sign-in, before its URL is known. */
export interface AuthPopup {
  navigate(url: string): void;
  close(): void;
}

export interface ConnectionAuthPorts {
  /** Open a blank popup now, synchronously; null when the browser blocked it. */
  openPopup(): AuthPopup | null;
  authorize(connectionId: string): Promise<{ authorizationUrl?: string }>;
  /** Messages posted to this window (the callback page posts the completion). */
  onMessage(listener: (data: unknown) => void): () => void;
}

type SignInOutcome =
  /** The popup shows the authorization page. */
  | { status: "opened" }
  /** The browser refused the popup: ask the owner to allow pop-ups. */
  | { status: "blocked" }
  /** The server has no sign-in for this connection (not OAuth, or already signed in). */
  | { status: "no_url" }
  /** Creating the connection or asking for the URL failed. */
  | { status: "failed"; error: unknown };

/** What the callback page posts back: `tiny-agents:oauth`. */
interface SignInCompletion {
  id?: string;
  error?: string;
}

export interface ConnectionAuth {
  /**
   * Start a sign-in. Call it synchronously from the click handler: the
   * popup opens at once, and waits for `connectionId` (which may still be
   * resolving, when the connection is being created) and the server's
   * authorization URL. A failure on the way closes the popup again.
   */
  signIn(connectionId: string | Promise<string>): Promise<SignInOutcome>;
  /**
   * Hear a sign-in complete, for `connectionId` or (undefined) for any.
   * Returns the unsubscribe.
   */
  onCompleted(
    connectionId: string | undefined,
    handler: (completion: SignInCompletion) => void,
  ): () => void;
}

const COMPLETION_TYPE = "tiny-agents:oauth";

export function createConnectionAuth(ports: ConnectionAuthPorts): ConnectionAuth {
  return {
    async signIn(connectionId) {
      const popup = ports.openPopup();
      try {
        const id = typeof connectionId === "string" ? connectionId : await connectionId;
        const { authorizationUrl } = await ports.authorize(id);
        if (!authorizationUrl) {
          popup?.close();
          return { status: "no_url" };
        }
        if (!popup) return { status: "blocked" };
        popup.navigate(authorizationUrl);
        return { status: "opened" };
      } catch (error) {
        popup?.close();
        return { status: "failed", error };
      }
    },

    onCompleted(connectionId, handler) {
      return ports.onMessage((data) => {
        const message = data as { type?: unknown; id?: unknown; error?: unknown } | null;
        if (!message || message.type !== COMPLETION_TYPE) return;
        const id = typeof message.id === "string" ? message.id : undefined;
        if (connectionId !== undefined && id !== undefined && id !== connectionId) return;
        handler({
          ...(id !== undefined ? { id } : {}),
          ...(typeof message.error === "string" && message.error ? { error: message.error } : {}),
        });
      });
    },
  };
}

function openBrowserPopup(): AuthPopup | null {
  const popup = window.open(
    "about:blank",
    "tiny-agents-oauth",
    "popup=yes,width=640,height=720,scrollbars=yes",
  );
  if (!popup) return null;
  return {
    navigate: (url) => {
      popup.location.href = url;
    },
    close: () => popup.close(),
  };
}

/** The instance wired to the browser window and the connections API. */
export const connectionAuth: ConnectionAuth = createConnectionAuth({
  openPopup: openBrowserPopup,
  authorize: (id) => connectionsApi.authorize(id),
  onMessage: (listener) => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) listener(event.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  },
});
