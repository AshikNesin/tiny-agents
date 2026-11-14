/**
 * The one place that writes shell for the sandbox VM and reads its exit
 * codes. Every argument embedded in a remote command line is quoted here,
 * every multi-line script is wrapped here, and every exit code that means
 * something specific (a sentinel) is read here.
 *
 * Sentinel codes stay beside the script that exits with them (the desktop
 * tools in `computer-x11.ts`, confined commands in the agent's
 * `sandbox-egress.ts`), as a table this module reads. Their values are
 * frozen: the app and the script agree on them.
 */

/** POSIX single quotes: any string, as one word, with nothing expanded. */
export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Run a multi-line script (lines joined by newlines) as one SSH exec command. */
export function bashScript(script: string | readonly string[]): string {
  return `bash -c ${shQuote(typeof script === "string" ? script : script.join("\n"))}`;
}

/** What a shell exits with when the command is not installed. */
export const EXIT_COMMAND_NOT_FOUND = 127;

/** What the connection reports for a command killed by a signal, or a channel closed without a status. */
export const EXIT_NO_STATUS = 255;

/**
 * Shell that exits with `code`, after writing `message` to stderr when one
 * is given. The message sits in double quotes, so `$VAR` in it expands.
 */
export function exitWith(code: number, message?: string): string {
  return message === undefined ? `exit ${code}` : `{ echo "${message}" >&2; exit ${code}; }`;
}

/**
 * What an exit code says, given the script's sentinel table: the sentinel's
 * name, `ok` for 0, `failed` for any other code.
 */
export function exitSentinel<K extends string>(
  exitCode: number,
  sentinels: Readonly<Record<K, number>>,
): K | "ok" | "failed" {
  if (exitCode === 0) return "ok";
  for (const name of Object.keys(sentinels) as K[]) {
    if (sentinels[name] === exitCode) return name;
  }
  return "failed";
}

/** The end of a failed command's output a message quotes: stderr, else stdout, trimmed. */
export function failureDetail(
  result: { stdout: Buffer | string; stderr: string },
  maxChars: number,
): string {
  const stdout = typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf8");
  return (result.stderr || stdout).trim().slice(-maxChars);
}
