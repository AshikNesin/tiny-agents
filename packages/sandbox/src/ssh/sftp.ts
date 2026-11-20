import { randomBytes } from "node:crypto";
import type { SFTPWrapper } from "ssh2";

export async function readCapped(
  s: SFTPWrapper,
  path: string,
  maxBytes: number,
): Promise<{ bytes: Buffer; size: number; truncated: boolean }> {
  const readSize = Math.min(maxBytes + 1, 65_536);
  const buffer = Buffer.alloc(readSize);
  const chunks: Buffer[] = [];
  let offset = 0;
  const handle = await new Promise<Buffer>((resolve, reject) =>
    s.open(path, "r", (e, h) => (e ? reject(sftpError(e, path)) : resolve(h))),
  );
  try {
    for (;;) {
      const bytesRead = await new Promise<number>((resolve, reject) =>
        s.read(handle, buffer, 0, readSize, offset, (e, b) =>
          e ? reject(sftpError(e, path)) : resolve(b),
        ),
      );
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      offset += bytesRead;
      if (offset > maxBytes) break;
    }
    const all = Buffer.concat(chunks);
    const truncated = all.length > maxBytes;
    return {
      bytes: truncated ? all.subarray(0, maxBytes) : all,
      size: all.length,
      truncated,
    };
  } finally {
    s.close(handle, () => {});
  }
}

export async function writeAtomic(
  s: SFTPWrapper,
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const tmp = `${path}.ta-tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await new Promise<void>((resolve, reject) =>
      s.writeFile(
        tmp,
        typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content),
        (e) => (e ? reject(sftpError(e, tmp)) : resolve()),
      ),
    );
    await new Promise<void>((resolve, reject) =>
      s.rename(tmp, path, (e) => (e ? reject(sftpError(e, path)) : resolve())),
    );
  } catch (error) {
    s.unlink(tmp, () => {});
    throw error;
  }
}

function sftpError(error: unknown, path: string): Error {
  const code =
    error && typeof error === "object" && "code" in error ? Number(error.code) : undefined;
  if (code === 2) return new Error(`No such file: ${path}`);
  if (code === 3) return new Error(`Permission denied: ${path}`);
  return error instanceof Error ? error : new Error(String(error));
}
