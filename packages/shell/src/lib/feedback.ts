import { useRef, useState, type ReactNode } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConfirm } from "@groot/ui/primitives";
import type { ConfirmOptions } from "@groot/ui/primitives/confirm";
import { ApiError, NetworkError } from "@groot/shell/lib/api";

export const OFFLINE_MESSAGE = "Could not reach the server. Check your connection and try again.";

export const WEBAUTHN_MESSAGES: Readonly<Record<string, string>> = {
  NotAllowedError: "The passkey request was cancelled or timed out. Please try again.",
  NotSupportedError: "Passkeys are not supported in this browser.",
  InvalidStateError: "This passkey is already registered to your account.",
  SecurityError: "Passkeys are not available on this address. Open the app on its own domain.",
};

const FETCH_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i;

export function describeWebAuthnError(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { name, code } = error as { name?: unknown; code?: unknown };
  if (typeof name !== "string" || !Object.hasOwn(WEBAUTHN_MESSAGES, name)) return undefined;
  const fromBrowser = typeof DOMException !== "undefined" && error instanceof DOMException;
  const fromLibrary = typeof code === "string" && code.startsWith("ERROR_");
  return fromBrowser || fromLibrary ? WEBAUTHN_MESSAGES[name] : undefined;
}

export function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError)
    return error.fromServer && error.message ? error.message : fallback;
  if (error instanceof NetworkError) return OFFLINE_MESSAGE;
  if (error instanceof TypeError) {
    return FETCH_FAILURE.test(error.message) ? OFFLINE_MESSAGE : fallback;
  }
  const webAuthn = describeWebAuthnError(error);
  if (webAuthn) return webAuthn;
  const ownError =
    error instanceof Error &&
    Object.getPrototypeOf(error) === Error.prototype &&
    error.name === "Error";
  return ownError && error.message ? error.message : fallback;
}

export type ToastContent = string | { title: string; description?: ReactNode };

export function toastSuccess(content: ToastContent): void {
  if (typeof content === "string") toast.success(content);
  else toast.success(content.title, { description: content.description });
}

export function toastError(
  error: unknown,
  { title, fallback }: { title: string; fallback: string },
) {
  console.error(error);
  toast.error(title, { description: describeError(error, fallback) });
}

export interface ActionOptions<TVars, TData> {
  confirm?: ConfirmOptions | ((vars: TVars) => ConfirmOptions | null);
  success?: ToastContent | ((data: TData, vars: TVars) => ToastContent);
  errorTitle?: string;
  fallback: string | ((vars: TVars) => string);
  invalidate?: QueryKey[] | ((data: TData, vars: TVars) => QueryKey[]);
  onSuccess?: (data: TData, vars: TVars) => void | Promise<void>;
}

export type ActionResult<TData> =
  | { ok: true; data: TData }
  | { ok: false; reason: "cancelled" | "busy" }
  | { ok: false; reason: "failed"; error: unknown };

export interface Action<TVars, TData> {
  run: (vars: TVars) => Promise<ActionResult<TData>>;
  isPending: boolean;
}

export function useAction<TVars = void, TData = unknown>(
  action: (vars: TVars) => Promise<TData>,
  options: ActionOptions<TVars, TData>,
): Action<TVars, TData> {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const busy = useRef(false);
  const [isPending, setPending] = useState(false);

  const run = async (vars: TVars): Promise<ActionResult<TData>> => {
    if (busy.current) return { ok: false, reason: "busy" };
    busy.current = true;
    try {
      const question =
        typeof options.confirm === "function" ? options.confirm(vars) : options.confirm;
      if (question && !(await confirm(question))) return { ok: false, reason: "cancelled" };

      setPending(true);
      let data: TData;
      try {
        data = await action(vars);
      } catch (error) {
        toastError(error, {
          title: options.errorTitle ?? "Something went wrong",
          fallback:
            typeof options.fallback === "function" ? options.fallback(vars) : options.fallback,
        });
        return { ok: false, reason: "failed", error };
      }

      if (options.success) {
        toastSuccess(
          typeof options.success === "function" ? options.success(data, vars) : options.success,
        );
      }
      const keys =
        typeof options.invalidate === "function"
          ? options.invalidate(data, vars)
          : (options.invalidate ?? []);
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      await options.onSuccess?.(data, vars);
      return { ok: true, data };
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return { run, isPending };
}
