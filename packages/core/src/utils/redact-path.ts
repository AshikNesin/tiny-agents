const SECRET_SEGMENT = /\/routines\/hooks\/([^/?#]+)/g;

const REDACTED = "[redacted]";

export function redactSecretPath(path: string): string {
  return path.replaceAll(SECRET_SEGMENT, `/routines/hooks/${REDACTED}`);
}
