/**
 * The `sandbox` toolkit (issue #19): a keyless shell on the shared sandbox
 * VM over Tailscale SSH. The tailnet is the authentication (no keys, no
 * passwords — the tagged node identity is what the ACL accepts), so the
 * toolkit only needs a host, a port and a unix user.
 *
 * Transport is a narrow port (`sandbox-ssh2`) so tests and the app can
 * substitute it; ssh2 is the production default.
 *
 * Replay: `read_file` is pure (`safe`); `run_command` and `write_file`
 * have side effects and stay `unsafe` — the approval gate's start-marked
 * memo (`approvals.ts`) then reports "interrupted" on a crash instead of
 * re-running a command or a write.
 *
 * Vault secrets (issue #56): `run_command` can take `secrets: [{handle,
 * env}]`. Every such call is approved on its own card showing the full
 * command, the items must list `run_command` and name the hosts the key may
 * reach, the values travel over stdin into env vars, and the command runs
 * confined to those hosts (`sandbox-egress.ts`). With an egress allowlist
 * configured, every command runs confined to it.
 */
import { Type } from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  type JsonObject,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import { gateApproved, withGatePlan, type GatePlan } from "../approvals";
import type { Capability } from "../capabilities";
import {
  VAULT_RULE,
  VaultError,
  type SecretValue,
  type VaultBroker,
  type VaultItemMeta,
} from "../vault";
import {
  checkEnvName,
  commandHosts,
  CONFINE_UNAVAILABLE,
  confinedCommand,
  MAX_COMMAND_SECRETS,
  parseEgressList,
  SECRETS_MISSING,
  type EgressEntry,
} from "./sandbox-egress";
import { createSsh2Transport, PreDispatchError, type HostKeyStore } from "./sandbox-ssh2";
import { safeMessage, VAULT_APPROVAL_TTL_MS } from "./vault";

export { createMemoryHostKeyStore, createSsh2Transport, PreDispatchError } from "./sandbox-ssh2";
export type { HostKeyStore } from "./sandbox-ssh2";

/** One command's outcome: combined output plus exit status. */
export interface ExecResult {
  output: string;
  exitCode: number;
}

export interface ExecOptions {
  timeoutMs?: number;
  /** Written to the command's stdin, which is then closed. */
  stdin?: string;
}

/** What the tools need from a live connection — the whole SSH surface they see. */
export interface SandboxSession {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  readFile(
    path: string,
    options?: { maxBytes?: number },
  ): Promise<{ text: string; truncated: boolean }>;
  writeFile(path: string, content: string): Promise<void>;
  close(): void;
}

export interface ConnectOptions {
  host: string;
  port: number;
  user: string;
  hostKeys?: HostKeyStore;
  connectTimeoutMs?: number;
}

/** The transport port: production is ssh2, tests substitute fakes. */
export type SandboxTransport = (options: ConnectOptions) => Promise<SandboxSession>;

export interface SandboxToolkitOptions {
  /** MagicDNS name or Tailscale IP of the sandbox VM. */
  host?: string;
  port?: number;
  /** Unix user for the session; must match the ACL rule's `users`. Default `exedev`. */
  user?: string;
  /** TOFU host-key pinning; unset trusts every connection (WireGuard still authenticates the endpoint). */
  hostKeys?: HostKeyStore;
  /** Override for tests or alternate transports. Default: ssh2. */
  transport?: SandboxTransport;
  /** Command timeout in seconds (default 120). */
  defaultTimeoutSecs?: number;
  /** The vault broker: enables `secrets` on `run_command` (issue #56). */
  vault?: VaultBroker;
  /**
   * Outbound allowlist (hostnames, IPs or CIDRs). When set, every
   * `run_command` runs confined to it; commands with secrets may also reach
   * their items' hosts. Unset, only commands with secrets are confined.
   */
  egressAllowlist?: string;
}

const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

/** One readable line per error: connection failures must not be stack traces. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Errors can pass through more than one layer that describes them; wrap
  // once, or the UI reads "Cannot reach the sandbox (Cannot reach …)".
  if (message.startsWith("Cannot reach the sandbox")) return message;
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/.test(message)
    ? `Cannot reach the sandbox (${message}). Is it online and on the tailnet?`
    : message;
}

export function createSandboxToolkit(options: SandboxToolkitOptions = {}): Capability {
  const configured = Boolean(options.host);
  const transport = options.transport ?? createSsh2Transport();

  // One pooled connection per toolkit instance (one per server process when
  // wired in bots.runtime.ts), opened lazily on first tool use. Concurrent
  // tools share it — ssh2 multiplexes exec/SFTP channels over one connection.
  let session: Promise<SandboxSession> | undefined;
  const dial = (): Promise<SandboxSession> => {
    // Never fall through to ssh2's defaults: an unset host would dial
    // localhost — the app server itself — so refuse to dial at all.
    if (!options.host) {
      return Promise.reject(
        new Error("Sandbox is not configured: set SANDBOX_HOST on the server."),
      );
    }
    const attempt = transport({
      host: options.host!,
      port: options.port ?? 22,
      user: options.user ?? "exedev",
      hostKeys: options.hostKeys,
    });
    attempt.catch(() => {
      if (session === attempt) session = undefined; // don't cache a failed dial
    });
    return attempt;
  };

  const withSession = async <T>(fn: (s: SandboxSession) => Promise<T>): Promise<T> => {
    const acquire = async (): Promise<SandboxSession> => {
      try {
        return await (session ??= dial());
      } catch {
        session = undefined; // a failed dial must not be cached
        return await (session = dial());
      }
    };
    const s = await acquire();
    try {
      return await fn(s);
    } catch (error) {
      session = undefined; // a session that just failed is not reused
      // Retry only when nothing was dispatched: a pre-dispatch failure
      // (channel open refused on a dead pooled connection) never started the
      // command, so re-running it cannot double a side effect. Anything after
      // dispatch is surfaced, honoring the tools' `unsafe` replay contract.
      if (!isPreDispatch(error)) throw error;
      return fn(await acquire());
    }
  };

  const egress = parseEgressList(options.egressAllowlist ?? "");
  const broker = options.vault;

  const secretSchema = Type.Object({
    handle: Type.String({ minLength: 1, maxLength: 64, description: "Vault handle (vault_list)" }),
    env: Type.String({
      minLength: 1,
      maxLength: 64,
      description: "Env var name, e.g. GITHUB_TOKEN",
    }),
  });

  type RunArgs = {
    command: string;
    detached?: boolean;
    timeout_secs?: number;
    secrets?: { handle: string; env: string }[];
  };

  /** The items a call names, or why the call can't run. */
  const secretItems = async (
    args: RunArgs,
    conversation: number,
  ): Promise<{ items: VaultItemMeta[] } | { refuse: string }> => {
    const secrets = args.secrets ?? [];
    if (!broker) return { refuse: "The vault is not configured." };
    if (secrets.length > MAX_COMMAND_SECRETS) {
      return { refuse: `At most ${MAX_COMMAND_SECRETS} secrets per command.` };
    }
    if (args.detached) return { refuse: "Secrets can't be passed to a detached command." };
    const names = new Set<string>();
    for (const secret of secrets) {
      const problem = checkEnvName(secret.env);
      if (problem) return { refuse: problem };
      if (names.has(secret.env)) return { refuse: `${secret.env} is named twice.` };
      names.add(secret.env);
    }
    const listed = await broker.list({ conversation, tool: "run_command" });
    const items: VaultItemMeta[] = [];
    for (const secret of secrets) {
      const item = listed.find((candidate) => candidate.handle === secret.handle);
      // Unknown or not allowed for run_command: the broker's plan refuses
      // with the precise reason (and audits it).
      if (item) items.push(item);
    }
    return { items };
  };

  /** Where a command may connect: the allowlist, plus its secrets' hosts. */
  const allowedFor = (items: VaultItemMeta[]): EgressEntry[] => [
    ...egress.entries,
    ...parseEgressList(items.flatMap((item) => item.allowedHosts)).entries,
  ];

  const hostAllowed = (host: string, allow: EgressEntry[]) =>
    allow.some((entry) => "host" in entry && entry.host === host);

  const planSecrets = async (args: RunArgs, api: Parameters<GatePlanFn>[1], toolAsks: boolean) => {
    if (!args.secrets?.length) return { ask: toolAsks } satisfies GatePlan;
    const found = await secretItems(args, Number(api.conversationId));
    if ("refuse" in found) return { refuse: found.refuse, ask: false };
    const cards: JsonObject[] = [];
    for (const secret of args.secrets) {
      const plan = await broker!.plan({
        handle: secret.handle,
        tool: "run_command",
        target: args.command,
        conversation: Number(api.conversationId),
        granted: false,
      });
      if (plan.refused) return { refuse: plan.message, ask: false };
      cards.push(plan.card as unknown as JsonObject);
    }
    // A heuristic early refusal; the confinement below is the real control.
    const allow = allowedFor(found.items);
    const stray = commandHosts(args.command).filter((host) => !hostAllowed(host, allow));
    if (stray.length > 0) {
      for (const secret of args.secrets) {
        await broker!.record(
          {
            handle: secret.handle,
            tool: "run_command",
            target: args.command,
            conversation: Number(api.conversationId),
            granted: false,
          },
          "refused_policy",
          `command names ${stray.join(", ")}`,
        );
      }
      return {
        refuse: `This command names ${stray.join(", ")}, which its secrets may not reach. Allowed: ${allow.map((e) => ("host" in e ? e.host : e.cidr)).join(", ") || "nothing"}.`,
        ask: false,
      };
    }
    const first = cards[0] as unknown as { bot?: string };
    return {
      // Env injection asks every time: the model wrote the code holding the secret.
      ask: true,
      details: {
        vault: {
          handle: args.secrets.map((s) => s.handle).join(", "),
          label: cards.map((card) => String(card.label)).join(", "),
          kind: "api_key",
          tool: "run_command",
          target: args.command.length > 2000 ? `${args.command.slice(0, 2000)}…` : args.command,
          ...(first.bot ? { bot: first.bot } : {}),
          env: args.secrets.map((s) => s.env),
          hosts: allow.map((e) => ("host" in e ? e.host : e.cidr)),
          grantable: false,
        },
      },
      expiresInMs: VAULT_APPROVAL_TTL_MS,
    } satisfies GatePlan;
  };

  const runCommand = withGatePlan(
    defineTool({
      name: "run_command",
      description:
        "Run a shell command on the sandbox VM and return stdout, stderr and the exit code. " +
        "One command string per call — chain with && or ; for steps. " +
        "Set detached:true for long builds or servers: the command keeps running after this call returns." +
        (broker
          ? " To give the command an API key, pass secrets: [{handle, env}] with a vault handle that allows run_command; " +
            'the value arrives in that env var (use "$GITHUB_TOKEN", never echo it), every such call is approved by the owner, ' +
            "and the command can only reach the item's hosts. " +
            VAULT_RULE
          : "") +
        (egress.entries.length > 0
          ? " Commands can only connect to the owner's allowlist: " +
            egress.entries.map((e) => ("host" in e ? e.host : e.cidr)).join(", ") +
            "."
          : ""),
      parameters: Type.Object({
        command: Type.String({ minLength: 1, maxLength: 20_000 }),
        detached: Type.Optional(Type.Boolean()),
        timeout_secs: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
        ...(broker
          ? {
              secrets: Type.Optional(
                Type.Array(secretSchema, { minItems: 1, maxItems: MAX_COMMAND_SECRETS }),
              ),
            }
          : {}),
      }),
      replay: "unsafe",
      execute: async (raw, api, context) => {
        const args = raw as RunArgs;
        const timeoutSecs = args.timeout_secs ?? options.defaultTimeoutSecs ?? 120;
        const timeoutMs = timeoutSecs * 1000;
        // The whole command runs as one sh -c argument, so chains (&&, ;) stay
        // inside the detached session and the redirect covers every step.
        const detach = (command: string) =>
          `setsid nohup sh -c ${shellQuote(command)} > /tmp/ta-detached-$$.log 2>&1 < /dev/null & printf '%s' "$!"`;
        const shaped = args.detached ? detach(args.command) : args.command;
        const run = (allow: EgressEntry[] | undefined, secretEnv?: string[], stdin?: string) =>
          withSession((s) =>
            s.exec(
              allow ? confinedCommand({ command: shaped, allow, secretEnv, timeoutSecs }) : shaped,
              { timeoutMs, ...(stdin !== undefined ? { stdin } : {}) },
            ),
          );
        try {
          let result: ExecResult;
          if (args.secrets?.length) {
            const found = await secretItems(args, Number(api.conversationId));
            if ("refuse" in found) return fail(found.refuse);
            const secrets = args.secrets;
            const approved = await gateApproved(api, context);
            // Each secret is resolved inside the previous one's sink, so no
            // value outlives the call or leaves the broker's audited scope.
            const withSecrets = async (
              index: number,
              values: SecretValue[],
            ): Promise<ExecResult> => {
              if (index === secrets.length) {
                const lines = values.map((value) => value.reveal());
                if (lines.some((line) => /[\r\n\0]/.test(line))) {
                  throw new Error("A multi-line secret can't be passed as an env var.");
                }
                return run(
                  allowedFor(found.items),
                  secrets.map((s) => s.env),
                  `${lines.join("\n")}\n`,
                );
              }
              return broker!.use(
                {
                  handle: secrets[index].handle,
                  tool: "run_command",
                  target: args.command,
                  conversation: Number(api.conversationId),
                  granted: false,
                  approved,
                },
                ["value"],
                async (resolved) => withSecrets(index + 1, [...values, resolved.value!]),
              );
            };
            result = await withSecrets(0, []);
          } else {
            result = await run(egress.entries.length > 0 ? egress.entries : undefined);
          }
          if (result.exitCode === CONFINE_UNAVAILABLE) {
            return fail(
              `The sandbox VM can't confine commands (it needs systemd and passwordless sudo):\n${result.output}`,
            );
          }
          if (result.exitCode === SECRETS_MISSING && args.secrets?.length) {
            return fail("The secrets did not reach the command. Nothing ran.");
          }
          if (result.exitCode !== 0) {
            return {
              output: [{ type: "text", text: `exit ${result.exitCode}\n${result.output}` }],
              isError: true,
              details: { exitCode: result.exitCode },
            };
          }
          return {
            output: [{ type: "text", text: result.output }],
            details: { exitCode: result.exitCode },
          };
        } catch (error) {
          return fail(error instanceof VaultError ? safeMessage(error) : describe(error));
        }
      },
    }),
    {
      plan: (args, api, _context, toolAsks) => planSecrets(args as RunArgs, api, toolAsks),
      async settled(args, api, _context, decision) {
        for (const secret of (args as RunArgs).secrets ?? []) {
          await broker?.record(
            {
              handle: secret.handle,
              tool: "run_command",
              target: (args as RunArgs).command,
              conversation: Number(api.conversationId),
              granted: false,
            },
            decision,
          );
        }
      },
    },
  );

  const readFile = defineTool({
    name: "read_file",
    description:
      "Read a file from the sandbox VM. Binary-safe; non-UTF-8 bytes are described, not corrupted. " +
      "Use max_bytes to cap huge files.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 4096 }),
      max_bytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
    }),
    replay: "safe",
    execute: async (args) => {
      try {
        const file = await withSession((s) =>
          s.readFile(args.path, { maxBytes: args.max_bytes ?? 200_000 }),
        );
        return {
          output: [{ type: "text", text: file.text }],
          details: { truncated: file.truncated },
        };
      } catch (error) {
        return fail(describe(error));
      }
    },
  });

  const writeFile = defineTool({
    name: "write_file",
    description:
      "Create or overwrite a file on the sandbox VM with UTF-8 content. Written to a temp name " +
      "then renamed, so a crash mid-write never leaves a half file.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 4096 }),
      content: Type.String({ maxLength: 500_000 }), // empty = create/truncate
    }),
    replay: "unsafe",
    execute: async (args) => {
      try {
        await withSession((s) => s.writeFile(args.path, args.content));
        return { output: [{ type: "text", text: `Wrote ${args.path}` }] };
      } catch (error) {
        return fail(describe(error));
      }
    },
  });

  return {
    id: "sandbox",
    kind: "toolkit",
    name: "Sandbox",
    description: "Keyless shell and files on the sandbox VM over Tailscale SSH",
    extension: defineExtension({ name: "sandbox", tools: [runCommand, readFile, writeFile] }),
    tools: [
      {
        name: "run_command",
        label: "Ran a command",
        description: "Run a shell command on the sandbox VM",
      },
      {
        name: "read_file",
        label: "Read a file",
        description: "Read a file from the sandbox VM",
        readOnly: true,
      },
      {
        name: "write_file",
        label: "Wrote a file",
        description: "Write a file on the sandbox VM",
      },
    ],
    ...(configured ? {} : { setupHint: "Set SANDBOX_HOST to enable the sandbox." }),
    ...(egress.invalid.length > 0
      ? {
          setupHint: `SANDBOX_EGRESS_ALLOWLIST has entries that aren't hosts, IPs or CIDRs: ${egress.invalid.join(", ")}`,
        }
      : {}),
  };
}

/** POSIX single-quoting for embedding one argument in a remote shell line. */
function shellQuote(value: string): string {
  return `'` + value.replace(/'/g, `'\\''`) + `'`;
}

const isPreDispatch = (error: unknown): boolean => error instanceof PreDispatchError;

type GatePlanFn = Parameters<typeof withGatePlan>[1]["plan"];
