import type {
  ChannelQuota,
  NotificationChannel,
  OutgoingMessage,
  SendResult,
  ValidateResult,
} from "./notifier";

export const PUSHOVER_API = "https://api.pushover.net/1";
const TIMEOUT_MS = 10_000;

export interface PushoverOptions {
  token: () => string | undefined;
  user: () => string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface PushoverBody {
  status?: number;
  request?: string;
  errors?: unknown;
  token?: unknown;
  user?: unknown;
  devices?: unknown;
  limit?: unknown;
  remaining?: unknown;
  reset?: unknown;
}

function errorText(body: PushoverBody | undefined): string | undefined {
  if (!body || !Array.isArray(body.errors)) return undefined;
  const text = body.errors.filter((e) => typeof e === "string").join("; ");
  return text ? text.slice(0, 300) : undefined;
}

function badCredentials(body: PushoverBody | undefined): boolean {
  return body?.token === "invalid" || body?.user === "invalid";
}

function quotaFromHeaders(headers: Headers): ChannelQuota | undefined {
  const limit = Number(headers.get("x-limit-app-limit"));
  const remaining = Number(headers.get("x-limit-app-remaining"));
  const reset = Number(headers.get("x-limit-app-reset"));
  if (!headers.has("x-limit-app-remaining") || !Number.isFinite(remaining)) return undefined;
  return {
    limit: Number.isFinite(limit) ? limit : 0,
    remaining,
    reset: new Date((Number.isFinite(reset) ? reset : 0) * 1000),
  };
}

async function readBody(response: Response): Promise<PushoverBody | undefined> {
  try {
    return (await response.json()) as PushoverBody;
  } catch {
    return undefined;
  }
}

export function createPushoverChannel(options: PushoverOptions): NotificationChannel {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const credentials = () => {
    const token = options.token()?.trim();
    const user = options.user()?.trim();
    return token && user ? { token, user } : undefined;
  };

  async function post(path: string, fields: Record<string, string | undefined>) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== "") form.set(key, value);
    }
    return doFetch(`${PUSHOVER_API}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  return {
    id: "pushover",

    configured: () => credentials() !== undefined,

    async validate(device?: string): Promise<ValidateResult> {
      const creds = credentials();
      if (!creds) return { ok: false, reason: "invalid_credentials", detail: "not configured" };
      let response: Response;
      try {
        response = await post("users/validate.json", { ...creds, device });
      } catch (error) {
        return { ok: false, reason: "transient", detail: (error as Error).name };
      }
      const body = await readBody(response);
      if (response.status >= 500) {
        return { ok: false, reason: "transient", detail: `HTTP ${response.status}` };
      }
      if (response.ok && body?.status === 1) {
        const devices = Array.isArray(body.devices)
          ? body.devices.filter((d): d is string => typeof d === "string")
          : [];
        return { ok: true, devices };
      }
      return {
        ok: false,
        reason: "invalid_credentials",
        detail: errorText(body) ?? `HTTP ${response.status}`,
      };
    },

    async quota(): Promise<ChannelQuota | undefined> {
      const creds = credentials();
      if (!creds) return undefined;
      try {
        const response = await doFetch(
          `${PUSHOVER_API}/apps/limits.json?token=${encodeURIComponent(creds.token)}`,
          { signal: AbortSignal.timeout(timeoutMs) },
        );
        if (!response.ok) return undefined;
        const body = await readBody(response);
        if (typeof body?.limit !== "number" || typeof body.remaining !== "number") return undefined;
        return {
          limit: body.limit,
          remaining: body.remaining,
          reset: new Date((typeof body.reset === "number" ? body.reset : 0) * 1000),
        };
      } catch {
        return undefined;
      }
    },

    async send(message: OutgoingMessage): Promise<SendResult> {
      const creds = credentials();
      if (!creds) {
        return {
          ok: false,
          retryable: false,
          reason: "invalid_credentials",
          detail: "not configured",
        };
      }
      let response: Response;
      try {
        response = await post("messages.json", {
          ...creds,
          title: message.title,
          message: message.message,
          priority: String(message.priority),
          url: message.url,
          url_title: message.url ? message.urlTitle : undefined,
          ttl: message.ttlSeconds !== undefined ? String(message.ttlSeconds) : undefined,
          device: message.device,
        });
      } catch (error) {
        return { ok: false, retryable: true, reason: "transient", detail: (error as Error).name };
      }
      const body = await readBody(response);
      const quota = quotaFromHeaders(response.headers);
      if (response.status === 429) {
        return {
          ok: false,
          retryable: false,
          reason: "over_quota",
          detail: errorText(body) ?? "monthly message limit reached",
          resetAt: quota?.reset,
        };
      }
      if (response.status >= 500) {
        return {
          ok: false,
          retryable: true,
          reason: "transient",
          detail: `HTTP ${response.status}`,
        };
      }
      if (response.ok && body?.status === 1) {
        return {
          ok: true,
          providerId: typeof body.request === "string" ? body.request : "",
          quota,
        };
      }
      return {
        ok: false,
        retryable: false,
        reason: badCredentials(body) ? "invalid_credentials" : "invalid_input",
        detail: errorText(body) ?? `HTTP ${response.status}`,
      };
    },
  };
}
