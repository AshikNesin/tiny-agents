import { bashScript, exitWith, shQuote } from "@tiny-agents/sandbox";

export const CONFINE_UNAVAILABLE = 97;

const SECRETS_MISSING = 96;

export const CONFINED_EXITS = {
  confineUnavailable: CONFINE_UNAVAILABLE,
  secretsMissing: SECRETS_MISSING,
};

export const MAX_COMMAND_SECRETS = 4;

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

export function checkEnvName(name: string): string | undefined {
  if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name)) {
    return `"${name}" is not an env var name (uppercase letters, digits and _).`;
  }
  if (RESERVED_ENV.has(name) || name.startsWith("TA_") || name.startsWith("LD_")) {
    return `${name} can't hold a secret.`;
  }
  return undefined;
}

export type EgressEntry = { host: string } | { cidr: string };

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IPV4_CIDR = /^(\d{1,3})(\.\d{1,3}){3}(\/\d{1,2})?$/;
const IPV6_CIDR = /^[0-9a-f:]+(\/\d{1,3})?$/;

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

function secretPrelude(envNames: readonly string[]): string {
  return envNames
    .map(
      (name, index) =>
        `IFS= read -r TA_S${index} || ${exitWith(SECRETS_MISSING)}\nexport ${name}="$TA_S${index}"; unset TA_S${index}`,
    )
    .join("\n");
}

export interface ConfinedCommandOptions {
  command: string;
  allow: readonly EgressEntry[];
  secretEnv?: readonly string[];
  timeoutSecs: number;
}

export function confinedCommand(options: ConfinedCommandOptions): string {
  return bashScript(confinedScript(options));
}

export function confinedScript(options: ConfinedCommandOptions): string {
  const hosts = options.allow.flatMap((entry) => ("host" in entry ? [entry.host] : []));
  const cidrs = options.allow.flatMap((entry) => ("cidr" in entry ? [entry.cidr] : []));
  const inner = [secretPrelude(options.secretEnv ?? []), options.command]
    .filter(Boolean)
    .join("\n");
  const script = [
    `command -v systemd-run >/dev/null 2>&1 || ${exitWith(CONFINE_UNAVAILABLE, "Confined commands need systemd on the sandbox VM.")}`,
    `sudo -n true 2>/dev/null || ${exitWith(CONFINE_UNAVAILABLE, "Confined commands need passwordless sudo on the sandbox VM.")}`,
    'TA_HOSTS="$(mktemp)"',
    "printf '127.0.0.1 localhost\\n::1 localhost\\n' > \"$TA_HOSTS\"",
    `TA_ALLOW=${shQuote(cidrs.join(" "))}`,
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
