import { FORBIDDEN_BACKEND_FLAGS, FORBIDDEN_OVERRIDE_KEYS } from "@tiny-agents/claude-worker";
import { bashScript, shQuote } from "@tiny-agents/sandbox";

export const CLAUDE_WORKER_STACK_VERSION = "v1";

export const CLAUDE_WORKER_PACKAGES: Readonly<Record<string, string>> = {
  "@anthropic-ai/claude-agent-sdk": "0.3.318",
  "@anthropic-ai/claude-code": "2.1.318",
  ws: "8.22.0",
  zod: "4.6.7",
};

export const CLAUDE_WORKER_NODE_VERSION = "24.22.2";

export const DEFAULT_SANDBOX_WORKER_PORT = 8765;

const BAKED_WORKER_DIR = "/opt/tiny-agents/claude-worker";

const MARKER = `.stack-${CLAUDE_WORKER_STACK_VERSION}`;
const START_WAIT_SECONDS = 20;

const PRELUDE = [
  `if [ -d ${BAKED_WORKER_DIR} ] && [ -w ${BAKED_WORKER_DIR} ]; then DIR=${BAKED_WORKER_DIR}; else DIR="$HOME/.tiny-agents/claude-worker"; fi`,
  'NODE=""',
  'if [ -x "$DIR/node/bin/node" ]; then NODE="$DIR/node/bin/node";',
  "elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then",
  `  M="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"`,
  '  if [ "$M" -ge 20 ] 2>/dev/null; then NODE="$(command -v node)"; fi',
  "fi",
  'CLAUDE="$DIR/node_modules/.bin/claude"',
];

function stripOverrides(): string {
  return ["env", ...[...FORBIDDEN_OVERRIDE_KEYS, ...FORBIDDEN_BACKEND_FLAGS].map((k) => `-u ${k}`)]
    .join(" ")
    .trim();
}

export function workerPackageJson(): string {
  return JSON.stringify({
    name: "tiny-agents-claude-worker",
    private: true,
    type: "module",
    dependencies: CLAUDE_WORKER_PACKAGES,
  });
}

export function installWorkerCommand(): string {
  const node = CLAUDE_WORKER_NODE_VERSION;
  return bashScript(
    [
      "set -e",
      ...PRELUDE,
      'mkdir -p "$DIR"',
      `[ -f "$DIR/${MARKER}" ] && [ -n "$NODE" ] && [ -x "$CLAUDE" ] && { echo ready; exit 0; }`,
      'exec 9>"$DIR/install.lock"',
      "flock 9",
      `[ -f "$DIR/${MARKER}" ] && [ -n "$NODE" ] && [ -x "$CLAUDE" ] && { echo ready; exit 0; }`,
      'if [ -z "$NODE" ]; then',
      '  case "$(uname -s)" in Linux) OS=linux ;; Darwin) OS=darwin ;; *) echo "Unsupported sandbox OS: $(uname -s)" >&2; exit 1 ;; esac',
      '  case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "Unsupported sandbox CPU: $(uname -m)" >&2; exit 1 ;; esac',
      '  TMP="$(mktemp -d)"',
      `  curl -fsSL "https://nodejs.org/dist/v${node}/node-v${node}-$OS-$ARCH.tar.gz" | tar -xz -C "$TMP"`,
      '  rm -rf "$DIR/node"',
      `  mv "$TMP/node-v${node}-$OS-$ARCH" "$DIR/node"`,
      '  rm -rf "$TMP"',
      '  NODE="$DIR/node/bin/node"',
      "fi",
      'NODEBIN="$(dirname "$NODE")"',
      'NPM="$NODEBIN/npm"; [ -x "$NPM" ] || NPM="$(command -v npm)"',
      `printf '%s\\n' ${shQuote(workerPackageJson())} > "$DIR/package.json"`,
      'cd "$DIR"',
      'PATH="$NODEBIN:$PATH" "$NPM" install --omit=dev --no-audit --no-fund --loglevel=error',
      '[ -x "$CLAUDE" ] || { echo "Claude Code did not install (no $CLAUDE)" >&2; exit 1; }',
      `rm -f "$DIR"/.stack-*; touch "$DIR/${MARKER}"`,
      "echo installed",
    ].join("\n"),
  );
}

export function uploadWorkerCommand(sha: string): string {
  return bashScript(
    [
      "set -e",
      ...PRELUDE,
      'mkdir -p "$DIR"',
      'cat > "$DIR/worker.mjs.tmp"',
      'mv "$DIR/worker.mjs.tmp" "$DIR/worker.mjs"',
      `printf '%s\\n' ${shQuote(sha)} > "$DIR/worker.sha"`,
      "echo uploaded",
    ].join("\n"),
  );
}

export function ensureWorkerCommand(sha: string, port: number): string {
  const expected = shQuote(sha);
  return bashScript(
    [
      "set -e",
      ...PRELUDE,
      `[ -f "$DIR/${MARKER}" ] && [ -n "$NODE" ] && [ -x "$CLAUDE" ] || { echo missing; exit 0; }`,
      `[ -f "$DIR/worker.mjs" ] && [ "$(cat "$DIR/worker.sha" 2>/dev/null)" = ${expected} ] || { echo upload; exit 0; }`,
      'exec 9>"$DIR/start.lock"',
      `flock -w ${START_WAIT_SECONDS} 9`,
      '[ -s "$DIR/token" ] || ( umask 077; head -c 32 /dev/urandom | base64 | tr -d "\\n" > "$DIR/token" )',
      'mkdir -p "$HOME/.local/bin"',
      'command -v claude >/dev/null 2>&1 || [ -e "$HOME/.local/bin/claude" ] || ln -s "$CLAUDE" "$HOME/.local/bin/claude"',
      'PID="$(cat "$DIR/worker.pid" 2>/dev/null || true)"',
      `if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null && [ "$(cat "$DIR/running.sha" 2>/dev/null)" = ${expected} ] && (exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null; then`,
      '  echo "ok $(cat "$DIR/token")"',
      "  exit 0",
      "fi",
      '[ -n "$PID" ] && kill "$PID" 2>/dev/null || true',
      'pkill -f -- "$DIR/worker.mjs" 2>/dev/null || true',
      "sleep 0.5",
      'NODEBIN="$(dirname "$NODE")"',
      'CLAUDE_WORKER_TOKEN="$(cat "$DIR/token")" CLAUDE_WORKER_PORT=' +
        port +
        ' CLAUDE_CODE_COMMAND="$CLAUDE" PATH="$NODEBIN:$PATH" setsid nohup ' +
        stripOverrides() +
        ' "$NODE" "$DIR/worker.mjs" </dev/null >"$DIR/worker.log" 2>&1 9>&- &',
      'echo "$!" > "$DIR/worker.pid"',
      `printf '%s\\n' ${expected} > "$DIR/running.sha"`,
      `WAIT=$((SECONDS + ${START_WAIT_SECONDS}))`,
      'while [ "$SECONDS" -lt "$WAIT" ]; do',
      `  if (exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null; then echo "ok $(cat "$DIR/token")"; exit 0; fi`,
      '  kill -0 "$(cat "$DIR/worker.pid")" 2>/dev/null || break',
      "  sleep 0.2",
      "done",
      `echo "The Claude worker did not start on the sandbox within ${START_WAIT_SECONDS}s" >&2`,
      'tail -n 20 "$DIR/worker.log" >&2 || true',
      "exit 1",
    ].join("\n"),
  );
}

export type EnsureResult =
  | { state: "missing" }
  | { state: "upload" }
  | { state: "ok"; token: string };

export function parseEnsureOutput(output: string): EnsureResult {
  const line = output.trim().split("\n").at(-1)?.trim() ?? "";
  if (line === "missing") return { state: "missing" };
  if (line === "upload") return { state: "upload" };
  const match = /^ok (\S+)$/.exec(line);
  if (match) return { state: "ok", token: match[1]! };
  throw new Error(
    `The sandbox gave an unexpected answer while starting the Claude worker: ${line}`,
  );
}

export function authStatusCommand(): string {
  return bashScript(
    [
      ...PRELUDE,
      '[ -x "$CLAUDE" ] || exit 0',
      `${stripOverrides()} "$CLAUDE" auth status || true`,
    ].join("\n"),
  );
}

export function stopWorkerCommand(): string {
  return bashScript(
    [
      ...PRELUDE,
      'PID="$(cat "$DIR/worker.pid" 2>/dev/null || true)"',
      '[ -n "$PID" ] && kill "$PID" 2>/dev/null || true',
      'rm -f "$DIR/worker.pid" "$DIR/running.sha"',
    ].join("\n"),
  );
}

export function claudeLoginShellLine(): string {
  return 'export PATH="$HOME/.local/bin:$PATH"; claude auth login';
}
