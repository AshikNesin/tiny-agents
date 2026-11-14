/**
 * A process stack on the sandbox VM: an X display that Xtigervnc serves
 * over RFB, with one app on it (the browser's Chrome, the computer's XFCE
 * session). The browser and the computer are two specs of this one module
 * (`browser-vm-setup.ts`, `computer-vm-setup.ts`); everything they share is
 * written once here, and each place they differed is a spec field
 * (docs/rewrite/README.md §4.2, the VmStack table).
 *
 * The shape every stack keeps, and that existing VMs depend on (the markers,
 * lock files and pid files are frozen, D9):
 *
 * - an install marker, `~/.tiny-agents/<name>-stack-<version>`, checked with
 *   the stack's binaries (and the owner's extra packages) before and after
 *   taking the VM-wide install lock, so two installers never run apt at once;
 * - a launch under the VM-wide launch lock (fd 8, given up after 25s), so two
 *   launches never pick the same display or port; every process that
 *   outlives the script closes that fd (`8>&-`);
 * - the profile's pid file, which the teardown and the next launch read;
 * - a report line, `ok key=<n> … [flag=1]`, parsed into a record.
 *
 * The scripts are pure strings, unit-tested without a VM; `createVmStack`
 * runs them over the caller's exec.
 */
import { bashScript, exitWith, shQuote } from "./shell";

/** Where every stack keeps its markers and locks on the VM. */
const STATE_DIR = "$HOME/.tiny-agents";

/** One installer at a time on the VM (fd 9). The browser's name: it was the first stack. */
const INSTALL_LOCK_FILE = "browser-stack.lock";

/** Serializes launches on a VM (fd 8): display numbers and ports are picked under it. */
export const LAUNCH_LOCK_FILE = "browser-launch.lock";

/** Closes the launch lock's fd in a child that outlives the script. */
export const RELEASE_LOCK = "8>&-";

const LOCK_WAIT_SECONDS = 25;
/** How long a launch waits for the X socket. */
export const X_WAIT_SECONDS = 10;
/** The fixed sleeps and process starts a launch spends beyond its waits. */
const LAUNCH_SLACK_SECONDS = 5;
/**
 * How much longer than its budget the app waits for a launch: a fresh SSH
 * dial. Giving up sooner would leave the script running on the VM, and a bare
 * timeout would hide its message.
 */
const LAUNCH_MARGIN_MS = 20_000;

/** What every launch takes: the profile's directory on the VM. */
export interface VmStackArgs {
  profileDir: string;
}

/** One exec of a stack script: its timeout, and how a failure names it. */
interface VmStackStep {
  timeoutMs: number;
  label: string;
}

/** One stack: its install, its launch script's parts, its report and its steps. */
export interface VmStackSpec<A extends VmStackArgs> {
  /** The install marker's name, `<name>-stack-<version>`: bump the version to re-run installs. */
  marker: string;
  /** Binaries that must be on PATH for the stack to count as installed. */
  commands: readonly string[];
  /** Debian packages dpkg must report installed as well (the owner's extras). */
  packages?: readonly string[];
  /** `inline`: the marker's path in a multi-line `if`; `variable`: `MARK` set first, one line. */
  readyLayout: "inline" | "variable";
  /** The install's own steps, between the locked re-check and the marker. Built when it runs. */
  installSteps(): readonly string[];
  launch: {
    /** Lines before the launch lock. */
    beforeLock?(args: A): readonly string[];
    /** Who else takes the launch lock, for the give-up message. */
    lockHolders: string;
    /** Lines under the lock that clear the profile's last run (or reattach to it and exit). */
    clearPrevious(args: A): readonly string[];
    /** Lines that set `VNC` (and any other port the app needs) to free loopback ports. */
    ports: readonly string[];
    /** Lines once a display is picked, before Xtigervnc starts: `XLOG` and the app's logs. */
    prepare(args: A): readonly string[];
    /** Xtigervnc's `-geometry`. */
    geometry(args: A): string;
    /** Xtigervnc's `-desktop` name. */
    desktopName: string;
    /** The profile's pid file: the X server first, then vncconfig, then the app's. */
    pidFile: string;
    /** Keep the X server's pid in this variable before recording it. */
    xPidVariable?: string;
    /** Lines right after the wait for the X socket. */
    afterX?: readonly string[];
    /** Lines that start the app on `$DISP` and record its pid. */
    start(args: A): readonly string[];
    /** The app is up once `probe` succeeds; the launch fails after `seconds`. */
    up: {
      probe: string;
      seconds: number;
      /** The deadline's variable. */
      deadline: string;
      /** stderr when the app did not come up. */
      failure: string;
      /** The logs whose tails follow it. */
      logs: string;
      /** Lines that stop what this launch started. */
      cleanup: readonly string[];
    };
    /** Lines once the app is up, before the report. */
    afterUp?(args: A): readonly string[];
    /** Waits beyond the lock, X and `up` ones, in seconds, for the launch budget. */
    otherWaitSeconds: number;
  };
  report: {
    /** Each key the report carries, in order, and the shell variable it prints. */
    variables: Readonly<Record<string, string>>;
    /** Keys a report may end with as `<flag>=1`. */
    flags?: readonly string[];
    /** The error for output with no report. */
    missing: string;
  };
  /** Lines that stop what the profile's last launch recorded (after `PROFILE=`). */
  teardown: readonly string[];
  /** Lines that stop everything on the profile before it is deleted (after `PROFILE=`). */
  wipe: readonly string[];
  steps: {
    check: VmStackStep;
    install: VmStackStep;
    launch: { label: string };
    stop: VmStackStep;
    wipe: VmStackStep;
  };
}

/** The test for an installed stack, with the marker as `mark` (a path or `$MARK`). */
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

/** Prints `ready` when the stack is installed, `missing` otherwise. */
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

/**
 * Idempotent first-run install, serialized on the VM by the install lock.
 * Prints `ready` (already installed) or `installed`.
 */
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

/** `echo "ok key=$VAR …"`: the report line, with each flag as `<flag>=1`. */
export function reportLine(
  variables: Readonly<Record<string, string>>,
  flags: readonly string[] = [],
): string {
  const pairs = Object.entries(variables).map(([key, variable]) => `${key}=$${variable}`);
  return `echo "ok ${[...pairs, ...flags.map((flag) => `${flag}=1`)].join(" ")}"`;
}

/**
 * Start Xtigervnc and the stack's app on it. Prints the report once the app
 * answers; on failure it stops what it started, prints the log tails, and
 * exits non-zero.
 */
export function launchScript<A extends VmStackArgs>(spec: VmStackSpec<A>, args: A): string {
  const launch = spec.launch;
  const up = launch.up;
  const pidFile = `"$PROFILE/${launch.pidFile}"`;
  const xPid = launch.xPidVariable;
  return bashScript([
    "set -e",
    `PROFILE=${shQuote(args.profileDir)}`,
    `mkdir -p "$PROFILE" "${STATE_DIR}"`,
    // Absolute, so the browser's and the computer's Chrome name one profile alike.
    'PROFILE="$(cd "$PROFILE" && pwd)"',
    ...(launch.beforeLock?.(args) ?? []),
    `exec 8>"${STATE_DIR}/${LAUNCH_LOCK_FILE}"`,
    `flock -w ${LOCK_WAIT_SECONDS} 8 || ${exitWith(1, `Gave up after ${LOCK_WAIT_SECONDS}s waiting for another ${launch.lockHolders} to finish starting on the VM`)}`,
    ...launch.clearPrevious(args),
    "sleep 0.3",
    // The bind-then-close window is short, and the lock serializes launches.
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
    // vncconfig bridges X selections and VNC clipboard messages: without it
    // copy and paste never reach the viewer.
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

/**
 * Upper bound on how long a launch script runs: its waits plus the fixed
 * sleeps and process starts. A caller that waits this long never walks away
 * from a script still running on the VM.
 */
export function launchBudgetMs(spec: VmStackSpec<never>): number {
  const { up, otherWaitSeconds } = spec.launch;
  return (
    (LOCK_WAIT_SECONDS + X_WAIT_SECONDS + up.seconds + otherWaitSeconds + LAUNCH_SLACK_SECONDS) *
    1000
  );
}

/** The first report in `output`, keys in order and digits only; throws `report.missing` without one. */
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

/** Stop what the profile's last launch recorded. */
export function teardownScript(spec: VmStackSpec<never>, profileDir: string): string {
  return bashScript([`PROFILE=${shQuote(profileDir)}`, ...spec.teardown]);
}

/** Delete the profile. The pause lets what was just stopped finish exiting, so it cannot rewrite files. */
export function wipeScript(spec: VmStackSpec<never>, profileDir: string): string {
  return bashScript([
    `PROFILE=${shQuote(profileDir)}`,
    ...spec.wipe,
    "sleep 1",
    'rm -rf "$PROFILE"',
  ]);
}

/** Runs one script on the VM; resolves with its stdout, rejects on a timeout or a non-zero exit. */
export type VmRun = (command: string, timeoutMs: number, label: string) => Promise<string>;

/** A stack on the VM, driven over the caller's exec. */
export interface VmStack<A extends VmStackArgs> {
  /** Install on first use; `onInstalling` runs just before an install starts. */
  ensureInstalled(onInstalling?: () => void): Promise<void>;
  /** Launch on the profile and read its report. A launch that failed is stopped first. */
  launch(args: A): Promise<Record<string, string>>;
  /** Stop what the profile's last launch started. */
  stop(profileDir: string): Promise<void>;
  /** Stop everything on the profile and delete it. */
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
        // A launch that broke after starting Xtigervnc or the app (a dropped
        // connection, an unreadable report) leaves them running with nothing
        // to stop them.
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
