type Env = Readonly<Record<string, string | undefined>>;

const unquote = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

/**
 * The sandbox VM host, or undefined when none is configured. Production
 * keeps the verified MagicDNS name (issue #19 runbook) as its default, so an
 * empty value there still reaches the VM; elsewhere empty means "no sandbox"
 * and the browser falls back to local Chromium (issue #79). One answer for
 * the sandbox, attachments, browser and terminal.
 */
export function sandboxHost(env: Env = process.env): string | undefined {
  return (
    unquote(env.SANDBOX_HOST) ?? (env.NODE_ENV === "production" ? "tiny-agents-vm" : undefined)
  );
}
