export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function bashScript(script: string | readonly string[]): string {
  return `bash -c ${shQuote(typeof script === "string" ? script : script.join("\n"))}`;
}

export const EXIT_COMMAND_NOT_FOUND = 127;

export const EXIT_NO_STATUS = 255;

export function exitWith(code: number, message?: string): string {
  return message === undefined ? `exit ${code}` : `{ echo "${message}" >&2; exit ${code}; }`;
}

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

export function failureDetail(
  result: { stdout: Buffer | string; stderr: string },
  maxChars: number,
): string {
  const stdout = typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf8");
  return (result.stderr || stdout).trim().slice(-maxChars);
}
