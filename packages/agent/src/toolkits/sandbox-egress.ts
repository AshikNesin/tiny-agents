/**
 * Confined sandbox commands (issue #56, phase 3): vault secrets as env vars
 * for one `run_command`, and an outbound allowlist for model-chosen commands
 * on the VM.
 *
 * The sandbox user has passwordless sudo, so a firewall it could edit (or a
 * group it could leave) would be undone by the next command. A confined
 * command therefore runs in a transient systemd unit (`sudo systemd-run`) the
 * command itself cannot loosen:
 *
 * - `NoNewPrivileges=yes`: sudo, su and other setuid helpers stop working;
 * - `IPAddressDeny=any` + `IPAddressAllow=<allowlist>`: the kernel's cgroup
 *   firewall drops every other destination, loopback and the tailnet included
 *   (so no Chrome DevTools port, no local proxy, no Connect server);
 * - `RestrictAddressFamilies=AF_INET AF_INET6`: no unix sockets (D-Bus, the
 *   resolver, X, docker), so names resolve only through
 * - a read-only `/etc/hosts` holding the allowlisted names, resolved just
 *   before the run: there is no DNS to tunnel a secret through.
 *
 * Secrets travel over the SSH channel's stdin, one line each, and are read
 * into the named env vars inside the unit — never argv (`/proc/*\/cmdline`),
 * never a file, never ssh `AcceptEnv`. Everything here is a pure string
 * builder so it can be tested without a VM.
 */
import { shQuote } from "./browser-vm-setup";

/** Exit code the wrapper uses for "the VM can't confine commands". */
export const CONFINE_UNAVAILABLE = 97;

/** Exit code when the secrets didn't arrive on stdin. */
export const SECRETS_MISSING = 96;

/** Most secrets one command may carry. */
export const MAX_COMMAND_SECRETS = 4;

/** Env names a secret may not take: they change how the shell or loader runs. */
const RESERVED_ENV = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "IFS",
  "ENV",
  "BASH_ENV",
  "PS4",
  "LANG",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "NODE_OPTIONS",
  "PYTHONPATH",
  "PERL5OPT",
]);

/** Why `name` can't hold a secret, or `undefined` when it can. */
export function checkEnvName(name: string): string | undefined {
  if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name)) {
    return `"${name}" is not an env var name (uppercase letters, digits and _).`;
  }
  if (RESERVED_ENV.has(name) || name.startsWith("TA_") || name.startsWith("LD_")) {
    return `${name} can't hold a secret.`;
  }
  return undefined;
}

/** A hostname (`api.github.com`) or an IP / CIDR (`140.82.112.0/20`). */
export type EgressEntry = { host: string } | { cidr: string };

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IPV4_CIDR = /^(\d{1,3})(\.\d{1,3}){3}(\/\d{1,2})?$/;
const IPV6_CIDR = /^[0-9a-f:]+(\/\d{1,3})?$/;

/** Parse a comma- or space-separated allowlist; unknown entries are reported, not dropped silently. */
export function parseEgressList(raw: string | readonly string[]): {
  entries: EgressEntry[];
  invalid: string[];
} {
  const items = (typeof raw === "string" ? raw.split(/[\s,]+/) : raw)
    .map((item) => item.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter(Boolean);
  const entries: EgressEntry[] = [];
  const invalid: string[] = [];
  for (const item of items) {
    if (HOST.test(item)) entries.push({ host: item });
    else if (IPV4_CIDR.test(item) || (item.includes(":") && IPV6_CIDR.test(item))) {
      entries.push({ cidr: item });
    } else invalid.push(item);
  }
  return { entries, invalid };
}

/** Hosts a command names in URLs (`https://evil.example/…`, `user@host:`-style git remotes). */
export function commandHosts(command: string): string[] {
  const hosts = new Set<string>();
  for (const match of command.matchAll(
    /\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@'"]*@)?([^\s/:'"?#]+)/gi,
  )) {
    hosts.add(match[1].toLowerCase());
  }
  for (const match of command.matchAll(/\b[\w.-]+@([a-z0-9.-]+\.[a-z]{2,}):/gi)) {
    hosts.add(match[1].toLowerCase());
  }
  return [...hosts];
}

/** The lines a confined command starts with: one stdin line per secret, into its env var. */
export function secretPrelude(envNames: readonly string[]): string {
  return envNames
    .map(
      (name, index) =>
        `IFS= read -r TA_S${index} || exit ${SECRETS_MISSING}\nexport ${name}="$TA_S${index}"; unset TA_S${index}`,
    )
    .join("\n");
}

export interface ConfinedCommandOptions {
  command: string;
  /** Destinations the command may reach; nothing else, not even loopback. */
  allow: readonly EgressEntry[];
  /** Env vars filled from stdin, in order. */
  secretEnv?: readonly string[];
  /** The unit is stopped after this long. */
  timeoutSecs: number;
}

/**
 * The remote shell line for a confined command: resolve the allowlist, then
 * run the command in a locked-down transient unit, forwarding stdin, stdout,
 * stderr and the exit code.
 */
export function confinedCommand(options: ConfinedCommandOptions): string {
  return `bash -c ${shQuote(confinedScript(options))}`;
}

/** The script `confinedCommand` runs, unwrapped (tests run it with stub tools). */
export function confinedScript(options: ConfinedCommandOptions): string {
  const hosts = options.allow.flatMap((entry) => ("host" in entry ? [entry.host] : []));
  const cidrs = options.allow.flatMap((entry) => ("cidr" in entry ? [entry.cidr] : []));
  const inner = [secretPrelude(options.secretEnv ?? []), options.command]
    .filter(Boolean)
    .join("\n");
  const script = [
    `command -v systemd-run >/dev/null 2>&1 || { echo "Confined commands need systemd on the sandbox VM." >&2; exit ${CONFINE_UNAVAILABLE}; }`,
    `sudo -n true 2>/dev/null || { echo "Confined commands need passwordless sudo on the sandbox VM." >&2; exit ${CONFINE_UNAVAILABLE}; }`,
    'TA_HOSTS="$(mktemp)"',
    "printf '127.0.0.1 localhost\\n::1 localhost\\n' > \"$TA_HOSTS\"",
    `TA_ALLOW=${shQuote(cidrs.join(" "))}`,
    // `for … in ;` with no words is a syntax error in some shells.
    ...(hosts.length > 0
      ? [
          `for TA_H in ${hosts.map(shQuote).join(" ")}; do`,
          "  for TA_IP in $(getent ahosts \"$TA_H\" | awk '{print $1}' | sort -u); do",
          '    TA_ALLOW="$TA_ALLOW $TA_IP"',
          '    printf \'%s %s\\n\' "$TA_IP" "$TA_H" >> "$TA_HOSTS"',
          "  done",
          "done",
        ]
      : []),
    'chmod 644 "$TA_HOSTS"',
    "sudo -n systemd-run --quiet --wait --pipe --collect \\",
    '  --uid="$(id -u)" --gid="$(id -g)" --working-directory="$HOME" \\',
    '  -E HOME="$HOME" -E USER="$(id -un)" -E PATH="$PATH" -E LANG=C.UTF-8 \\',
    "  -p NoNewPrivileges=yes -p PrivateDevices=yes -p IPAddressDeny=any \\",
    '  ${TA_ALLOW:+-p "IPAddressAllow=$TA_ALLOW"} \\',
    '  -p "RestrictAddressFamilies=AF_INET AF_INET6" \\',
    '  -p "BindReadOnlyPaths=$TA_HOSTS:/etc/hosts" \\',
    `  -p RuntimeMaxSec=${Math.max(1, Math.ceil(options.timeoutSecs))} \\`,
    `  -- sh -c ${shQuote(inner)}`,
    "TA_CODE=$?",
    'rm -f "$TA_HOSTS"',
    'exit "$TA_CODE"',
  ];
  return script.join("\n");
}
