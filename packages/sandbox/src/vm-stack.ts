import { bashScript, exitWith, shQuote } from "./shell";

const STATE_DIR = "$HOME/.tiny-agents";

const INSTALL_LOCK_FILE = "browser-stack.lock";

export const LAUNCH_LOCK_FILE = "browser-launch.lock";

export const RELEASE_LOCK = "8>&-";

const LOCK_WAIT_SECONDS = 25;
export const X_WAIT_SECONDS = 10;
const LAUNCH_SLACK_SECONDS = 5;
const LAUNCH_MARGIN_MS = 20_000;

export interface VmStackArgs {
  profileDir: string;
}

interface VmStackStep {
  timeoutMs: number;
  label: string;
}

export interface VmStackSpec<A extends VmStackArgs> {
  marker: string;
  commands: readonly string[];
  packages?: readonly string[];
  readyLayout: "inline" | "variable";
  installSteps(): readonly string[];
  launch: {
    beforeLock?(args: A): readonly string[];
    lockHolders: string;
    clearPrevious(args: A): readonly string[];
    ports: readonly string[];
    prepare(args: A): readonly string[];
    geometry(args: A): string;
    desktopName: string;
    pidFile: string;
    xPidVariable?: string;
    afterX?: readonly string[];
    start(args: A): readonly string[];
    up: {
      probe: string;
      seconds: number;
      deadline: string;
      failure: string;
      logs: string;
      cleanup: readonly string[];
    };
    afterUp?(args: A): readonly string[];
    otherWaitSeconds: number;
  };
  report: {
    variables: Readonly<Record<string, string>>;
    flags?: readonly string[];
    missing: string;
  };
  teardown: readonly string[];
  wipe: readonly string[];
  steps: {
    check: VmStackStep;
    install: VmStackStep;
    launch: { label: string };
    stop: VmStackStep;
    wipe: VmStackStep;
  };
}

function installedTest(spec: VmStackSpec<never>, mark: string): string {
  const commands = spec.commands.map((c) => `command -v ${c} >/dev/null 2>&1`).join(" && ");
  const packages = (spec.packages ?? [])
    .map(
      (p) =>
        `dpkg-query -W -f='\${Status}' ${shQuote(p)} 2>/dev/null | grep -q "install ok installed"`,
    )
    .join(" && ");
  return `[ -f "${mark}" ] && ${commands}${packages ? ` && ${packages}` : ""}`;
}

const markerPath = (spec: VmStackSpec<never>) => `${STATE_DIR}/${spec.marker}`;

export function readyScript(spec: VmStackSpec<never>): string {
  if (spec.readyLayout === "inline") {
    return bashScript([
      `if ${installedTest(spec, markerPath(spec))}; then`,
      "  echo ready",
      "else",
      "  echo missing",
      "fi",
    ]);
  }
  return bashScript([
    `MARK="${markerPath(spec)}"`,
    `if ${installedTest(spec, "$MARK")}; then echo ready; else echo missing; fi`,
  ]);
}

export function installScript(spec: VmStackSpec<never>): string {
  const ready = `${installedTest(spec, "$MARK")} && { echo ready; exit 0; }`;
  return bashScript([
    "set -e",
    `MARK="${markerPath(spec)}"`,
    ready,
    `mkdir -p "${STATE_DIR}"`,
    `exec 9>"${STATE_DIR}/${INSTALL_LOCK_FILE}"`,
    "flock 9",
    ready,
    ...spec.installSteps(),
    "sudo -n mkdir -p /tmp/.X11-unix",
    "sudo -n chmod 1777 /tmp/.X11-unix",
    'touch "$MARK"',
    "echo installed",
  ]);
}

export function reportLine(
  variables: Readonly<Record<string, string>>,
  flags: readonly string[] = [],
): string {
  const pairs = Object.entries(variables).map(([key, variable]) => `${key}=$${variable}`);
  return `echo "ok ${[...pairs, ...flags.map((flag) => `${flag}=1`)].join(" ")}"`;
}

export function launchScript<A extends VmStackArgs>(spec: VmStackSpec<A>, args: A): string {
  const launch = spec.launch;
  const up = launch.up;
  const pidFile = `"$PROFILE/${launch.pidFile}"`;
  const xPid = launch.xPidVariable;
  return bashScript([
    "set -e",
    `PROFILE=${shQuote(args.profileDir)}`,
    `mkdir -p "$PROFILE" "${STATE_DIR}"`,
    'PROFILE="$(cd "$PROFILE" && pwd)"',
    ...(launch.beforeLock?.(args) ?? []),
    `exec 8>"${STATE_DIR}/${LAUNCH_LOCK_FILE}"`,
    `flock -w ${LOCK_WAIT_SECONDS} 8 || ${exitWith(1, `Gave up after ${LOCK_WAIT_SECONDS}s waiting for another ${launch.lockHolders} to finish starting on the VM`)}`,
    ...launch.clearPrevious(args),
    "sleep 0.3",
    ...launch.ports,
    'DISP=""',
    "for n in $(seq 90 189); do",
    '  [ -e "/tmp/.X11-unix/X$n" ] && continue',
    '  [ -e "/tmp/.X$n-lock" ] && continue',
    '  DISP="$n"; break',
    "done",
    `[ -n "$DISP" ] || ${exitWith(1, "No free X display on the VM")}`,
    ...launch.prepare(args),
    `setsid nohup Xtigervnc ":$DISP" -geometry ${launch.geometry(args)} -depth 24 -rfbport "$VNC" -localhost -nolisten tcp -SecurityTypes None -AlwaysShared -desktop ${launch.desktopName} </dev/null >"$XLOG" 2>&1 ${RELEASE_LOCK} &`,
    ...(xPid ? [`${xPid}=$!`, `echo "$${xPid}" > ${pidFile}`] : [`echo "$!" > ${pidFile}`]),
    `XWAIT=$((SECONDS + ${X_WAIT_SECONDS}))`,
    'while [ ! -S "/tmp/.X11-unix/X$DISP" ] && [ "$SECONDS" -lt "$XWAIT" ]; do sleep 0.1; done',
    ...(launch.afterX ?? []),
    `DISPLAY=":$DISP" setsid nohup vncconfig -nowin </dev/null >"$PROFILE/.vncconfig.log" 2>&1 ${RELEASE_LOCK} &`,
    `echo "$!" >> ${pidFile}`,
    ...launch.start(args),
    "UP=0",
    `${up.deadline}=$((SECONDS + ${up.seconds}))`,
    `while [ "$SECONDS" -lt "$${up.deadline}" ]; do`,
    `  ${up.probe} && { UP=1; break; }`,
    "  sleep 0.2",
    "done",
    'if [ "$UP" != 1 ]; then',
    `  echo "${up.failure}" >&2`,
    `  tail -n 20 ${up.logs} >&2 || true`,
    ...up.cleanup.map((line) => `  ${line}`),
    "  exit 1",
    "fi",
    ...(launch.afterUp?.(args) ?? []),
    reportLine(spec.report.variables),
  ]);
}

export function launchBudgetMs(spec: VmStackSpec<never>): number {
  const { up, otherWaitSeconds } = spec.launch;
  return (
    (LOCK_WAIT_SECONDS + X_WAIT_SECONDS + up.seconds + otherWaitSeconds + LAUNCH_SLACK_SECONDS) *
    1000
  );
}

export function parseReport(
  output: string,
  report: VmStackSpec<never>["report"],
): Record<string, string> {
  const keys = Object.keys(report.variables);
  const flags = report.flags ?? [];
  const pattern = new RegExp(
    `ok ${keys.map((key) => `${key}=(\\d+)`).join(" ")}${flags.map((flag) => `( ${flag}=1)?`).join("")}`,
  );
  const match = pattern.exec(output);
  if (!match) throw new Error(report.missing);
  const values: Record<string, string> = {};
  keys.forEach((key, index) => (values[key] = match[index + 1]!));
  flags.forEach((flag, index) => {
    if (match[keys.length + index + 1] !== undefined) values[flag] = "1";
  });
  return values;
}

export function teardownScript(spec: VmStackSpec<never>, profileDir: string): string {
  return bashScript([`PROFILE=${shQuote(profileDir)}`, ...spec.teardown]);
}

export function wipeScript(spec: VmStackSpec<never>, profileDir: string): string {
  return bashScript([
    `PROFILE=${shQuote(profileDir)}`,
    ...spec.wipe,
    "sleep 1",
    'rm -rf "$PROFILE"',
  ]);
}

export type VmRun = (command: string, timeoutMs: number, label: string) => Promise<string>;

export interface VmStack<A extends VmStackArgs> {
  ensureInstalled(onInstalling?: () => void): Promise<void>;
  launch(args: A): Promise<Record<string, string>>;
  stop(profileDir: string): Promise<void>;
  wipe(profileDir: string): Promise<void>;
}

export function createVmStack<A extends VmStackArgs>(spec: VmStackSpec<A>, run: VmRun): VmStack<A> {
  const { steps } = spec;
  const stop = async (profileDir: string) => {
    await run(teardownScript(spec, profileDir), steps.stop.timeoutMs, steps.stop.label);
  };
  return {
    async ensureInstalled(onInstalling) {
      const ready = await run(readyScript(spec), steps.check.timeoutMs, steps.check.label);
      if (ready.trim() === "ready") return;
      onInstalling?.();
      await run(installScript(spec), steps.install.timeoutMs, steps.install.label);
    },
    async launch(args) {
      try {
        const output = await run(
          launchScript(spec, args),
          launchBudgetMs(spec) + LAUNCH_MARGIN_MS,
          steps.launch.label,
        );
        return parseReport(output, spec.report);
      } catch (error) {
        await stop(args.profileDir).catch(() => {});
        throw error;
      }
    },
    stop,
    async wipe(profileDir) {
      await run(wipeScript(spec, profileDir), steps.wipe.timeoutMs, steps.wipe.label);
    },
  };
}
