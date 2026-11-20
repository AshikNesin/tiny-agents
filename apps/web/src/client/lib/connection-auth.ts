import { connectionsApi } from "./connections-api";

export interface AuthPopup {
  navigate(url: string): void;
  close(): void;
}

export interface ConnectionAuthPorts {
  openPopup(): AuthPopup | null;
  authorize(connectionId: string): Promise<{ authorizationUrl?: string }>;
  onMessage(listener: (data: unknown) => void): () => void;
}

type SignInOutcome =
  | { status: "opened" }
  | { status: "blocked" }
  | { status: "no_url" }
  | { status: "failed"; error: unknown };

interface SignInCompletion {
  id?: string;
  error?: string;
}

export interface ConnectionAuth {
  signIn(connectionId: string | Promise<string>): Promise<SignInOutcome>;
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
