/**
 * The `sandbox` toolkit (issue #19): a keyless shell on the shared sandbox
 * VM over Tailscale SSH. The tailnet is the authentication (no keys, no
 * passwords: the tagged node identity is what the ACL accepts). The
 * toolkit takes the app's one `SandboxConnection` (`ssh/sandbox-connection`),
 * which owns the dial, the pool, the retry rule and host keys; tests
 * substitute an in-memory one.
 *
 * Replay: `read_file` is pure (`safe`); `run_command` and `write_file`
 * have side effects and stay `unsafe`: the approval gate's start-marked
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
import { defineExtension, defineTool, type ToolExecutionResult } from "@earendil-works/pi-durable";
import { withGatePlan, type GateHooks } from "../approvals";
import type { Capability } from "../capabilities";
import { VAULT_RULE, VaultError, type VaultBroker, type VaultItemMeta } from "../vault";
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
import { SandboxTimeoutError } from "../ssh/connection";
import type { SandboxConnection, SandboxExecResult } from "../ssh/sandbox-connection";
import {
  safeMessage,
  useAllFromSink,
  vaultGatePlan,
  type IntendedUse,
  type IntendedUses,
} from "./vault";

/** One command's outcome as the tool reports it: combined output plus exit status. */
interface CommandResult {
  output: string;
  exitCode: number;
}

export interface SandboxToolkitOptions {
  /** The app's connection to the sandbox VM; unset = no sandbox configured. */
  connection?: SandboxConnection;
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

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Bytes of each stream kept before the character cap trims; the rest is dropped live. */
const OUTPUT_BYTES = 60_000;
const OUTPUT_CHARS = 30_000;

/** stdout, then stderr on its own line, capped for the model. */
function combined(result: SandboxExecResult): CommandResult {
  const text = (
    result.stdout.toString("utf8") + (result.stderr ? `\n${result.stderr}` : "")
  ).trimEnd();
  return {
    output: text.length > OUTPUT_CHARS ? text.slice(0, OUTPUT_CHARS) + "\n… (truncated)" : text,
    exitCode: result.exitCode,
  };
}

export function createSandboxToolkit(options: SandboxToolkitOptions = {}): Capability {
  const connection = options.connection;

  /**
   * The connection, or why there is none. Never fall through to a default
   * host: an unset one would dial localhost, the app server itself.
   */
  const sandbox = (): SandboxConnection => {
    if (!connection) throw new Error("Sandbox is not configured: set SANDBOX_HOST on the server.");
    return connection;
  };

  const exec = async (
    command: string,
    execOptions: { timeoutMs: number; stdin?: string },
  ): Promise<CommandResult> => {
    try {
      return combined(await sandbox().exec(command, { ...execOptions, maxBytes: OUTPUT_BYTES }));
    } catch (error) {
      if (error instanceof SandboxTimeoutError) {
        throw new Error(
          `Command timed out after ${Math.round(execOptions.timeoutMs / 1000)}s. Rerun with detached:true if it must keep running.`,
        );
      }
      throw error;
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

  /** Why a call's secrets can't be passed, read from its arguments alone. */
  const secretsProblem = (args: RunArgs): string | undefined => {
    const secrets = args.secrets ?? [];
    if (!broker) return "The vault is not configured.";
    if (secrets.length > MAX_COMMAND_SECRETS) {
      return `At most ${MAX_COMMAND_SECRETS} secrets per command.`;
    }
    if (args.detached) return "Secrets can't be passed to a detached command.";
    const names = new Set<string>();
    for (const secret of secrets) {
      const problem = checkEnvName(secret.env);
      if (problem) return problem;
      if (names.has(secret.env)) return `${secret.env} is named twice.`;
      names.add(secret.env);
    }
    return undefined;
  };

  /** One vault use per secret: the target is the whole command. */
  const usesOf = (args: RunArgs): IntendedUse[] =>
    (args.secrets ?? []).map((secret) => ({
      handle: secret.handle,
      tool: "run_command",
      targetKind: "command",
      target: args.command,
    }));

  /** Where a command may connect: the allowlist, plus its secrets' hosts. */
  const allowedFor = (items: readonly VaultItemMeta[]): EgressEntry[] => [
    ...egress.entries,
    ...parseEgressList(items.flatMap((item) => item.allowedHosts)).entries,
  ];

  const hostAllowed = (host: string, allow: EgressEntry[]) =>
    allow.some((entry) => "host" in entry && entry.host === host);

  const shown = (allow: EgressEntry[]) => allow.map((e) => ("host" in e ? e.host : e.cidr));

  /**
   * What a call with secrets intends: a use per secret, refused when the
   * command names a host they may not reach, asked on one card that shows
   * the env vars and the hosts.
   */
  const intendedUses = async (
    args: RunArgs,
    conversation: number,
  ): Promise<IntendedUses | { refuse: string } | undefined> => {
    if (!args.secrets?.length) return undefined;
    const problem = secretsProblem(args);
    if (problem) return { refuse: problem };
    const listed = await broker!.list({ conversation, tool: "run_command" });
    // Unknown or not allowed for run_command: the broker's plan refuses
    // with the precise reason (and audits it).
    const items = args.secrets.flatMap(
      (secret) => listed.find((item) => item.handle === secret.handle) ?? [],
    );
    const allow = allowedFor(items);
    return {
      uses: usesOf(args),
      // Env injection asks every time: the model wrote the code holding the secret.
      everyUse: true,
      // A heuristic early refusal; the confinement below is the real control.
      confine: () => {
        const stray = commandHosts(args.command).filter((host) => !hostAllowed(host, allow));
        if (stray.length === 0) return undefined;
        return {
          refuse: `This command names ${stray.join(", ")}, which its secrets may not reach. Allowed: ${shown(allow).join(", ") || "nothing"}.`,
          reason: `command names ${stray.join(", ")}`,
        };
      },
      card: { env: args.secrets.map((s) => s.env), hosts: shown(allow) },
    };
  };

  /** run_command's gate: a call with secrets plans and asks through the vault's shared plan. */
  const runGate: GateHooks<RunArgs> = broker
    ? vaultGatePlan(broker, true, async (args: RunArgs, api) =>
        intendedUses(args, Number(api.conversationId)),
      )
    : {
        plan: async (args, _api, _context, toolAsks) =>
          args.secrets?.length
            ? { refuse: "The vault is not configured.", ask: false }
            : { ask: toolAsks },
      };

  const runCommand = withGatePlan(
    defineTool({
      name: "run_command",
      description:
        "Run a shell command on the sandbox VM and return stdout, stderr and the exit code. " +
        "One command string per call; chain with && or ; for steps. " +
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
          exec(
            allow ? confinedCommand({ command: shaped, allow, secretEnv, timeoutSecs }) : shaped,
            { timeoutMs, ...(stdin !== undefined ? { stdin } : {}) },
          );
        try {
          let result: CommandResult;
          if (args.secrets?.length) {
            const problem = secretsProblem(args);
            if (problem) return fail(problem);
            const env = args.secrets.map((s) => s.env);
            result = await useAllFromSink(
              broker!,
              api,
              context,
              usesOf(args),
              ["value"],
              async (values, items) => {
                const lines = values.map((value) => value.value!.reveal());
                if (lines.some((line) => /[\r\n\0]/.test(line))) {
                  throw new Error("A multi-line secret can't be passed as an env var.");
                }
                return run(allowedFor(items), env, `${lines.join("\n")}\n`);
              },
            );
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
          return fail(error instanceof VaultError ? safeMessage(error) : message(error));
        }
      },
    }),
    // The schema's args type `secrets` loosely (it exists only with a broker).
    runGate as GateHooks<never>,
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
        const file = await sandbox().readFile(args.path, { maxBytes: args.max_bytes ?? 200_000 });
        return {
          output: [
            {
              type: "text",
              text: looksUtf8(trimPartialRune(file.bytes))
                ? file.bytes.toString("utf8")
                : `[binary file, ${file.size} bytes]; inspect with run_command (file, hexdump -C | head)`,
            },
          ],
          details: { truncated: file.truncated },
        };
      } catch (error) {
        return fail(message(error));
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
        await sandbox().writeFile(args.path, args.content);
        return { output: [{ type: "text", text: `Wrote ${args.path}` }] };
      } catch (error) {
        return fail(message(error));
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
        askLabel: "run a command",
        description: "Run a shell command on the sandbox VM",
        vault: true,
      },
      {
        name: "read_file",
        label: "Read a file",
        askLabel: "read a file",
        description: "Read a file from the sandbox VM",
        readOnly: true,
      },
      {
        name: "write_file",
        label: "Wrote a file",
        askLabel: "write a file",
        description: "Write a file on the sandbox VM",
      },
    ],
    ...(connection ? {} : { setupHint: "Set SANDBOX_HOST to enable the sandbox." }),
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

/** Drop a trailing partial UTF-8 rune so a capped slice still validates as text. */
function trimPartialRune(buffer: Buffer): Buffer {
  for (let drop = 0; drop < 4 && buffer.length - drop > 0; drop++) {
    const last = buffer[buffer.length - 1 - drop];
    const need = last < 0x80 ? 0 : last < 0xe0 ? 1 : last < 0xf0 ? 2 : 3;
    if (need === 0) return buffer.subarray(0, buffer.length - drop);
    const start = buffer.length - 1 - drop - (need - 1);
    if (start >= 0 && buffer[start] >= 0xc0) return buffer.subarray(0, start);
  }
  return buffer;
}

function looksUtf8(buffer: Buffer): boolean {
  // Buffer.toString("utf8") replaces invalid sequences with U+FFFD; a clean
  // round-trip means the bytes are valid UTF-8.
  return !buffer.toString("utf8").includes("\uFFFD");
}
