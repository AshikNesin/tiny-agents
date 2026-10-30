import {
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
  stat,
  writeFile,
  copyFile as fsCopy,
} from "node:fs/promises";
import path from "node:path";
import {
  bodyContentType,
  bodyToBytes,
  groupByDelimiter,
  type ListOptions,
  type ListResult,
  type PutOptions,
  type StorageAdapter,
  type StorageBody,
  type StoredObject,
} from "./adapter";
import { getContentType } from "./storage.utils";
import { resolveSqlitePath } from "../database/node";
import type { Env } from "../env";

/** Default upload root for the Node runtime (git-ignored). */
export const LOCAL_UPLOADS_ROOT = "./local/uploads";

/**
 * Upload root for the Node entry. `UPLOADS_DIR` wins when set. In production the
 * default is `uploads/` next to the SQLite file (`file:/data/prod.db` →
 * `/data/uploads`), so the volume that keeps the database keeps the files too.
 * Elsewhere the default is LOCAL_UPLOADS_ROOT.
 */
export function uploadsRoot(
  env: Pick<Env, "NODE_ENV" | "DATABASE_URL"> & { UPLOADS_DIR?: string },
): string {
  if (env.UPLOADS_DIR) return env.UPLOADS_DIR;
  if (env.NODE_ENV !== "production") return LOCAL_UPLOADS_ROOT;
  const file = resolveSqlitePath(env.DATABASE_URL);
  return file === ":memory:" ? LOCAL_UPLOADS_ROOT : path.join(path.dirname(file), "uploads");
}

/**
 * Filesystem storage for Node. Objects are plain files under `root`; the
 * content type is derived from the extension on read. Directories left empty
 * by a delete are pruned so "folders" disappear like they do on object stores.
 */
export function localStorage(root: string = LOCAL_UPLOADS_ROOT): StorageAdapter {
  const absoluteRoot = path.resolve(root);

  const resolve = (key: string): string => {
    const target = path.resolve(absoluteRoot, key);
    if (target !== absoluteRoot && !target.startsWith(absoluteRoot + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return target;
  };

  const toObject = (key: string, size: number, mtime: Date): StoredObject => ({
    key,
    size,
    contentType: getContentType(key),
    lastModified: mtime,
  });

  const pruneEmptyParents = async (file: string): Promise<void> => {
    let dir = path.dirname(file);
    while (dir.startsWith(absoluteRoot + path.sep)) {
      try {
        await rmdir(dir); // ENOTEMPTY / ENOENT both mean "stop here"
      } catch {
        return;
      }
      dir = path.dirname(dir);
    }
  };

  /** Every file key under `dir`, relative to the root, sorted. */
  const walk = async (dir: string): Promise<string[]> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const keys: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) keys.push(...(await walk(full)));
      else keys.push(path.relative(absoluteRoot, full).split(path.sep).join("/"));
    }
    return keys.sort();
  };

  const headKey = async (key: string): Promise<StoredObject | null> => {
    try {
      const info = await stat(resolve(key));
      return info.isFile() ? toObject(key, info.size, info.mtime) : null;
    } catch {
      return null;
    }
  };

  return {
    name: "local",

    async put(key: string, body: StorageBody, options?: PutOptions) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      const bytes = await bodyToBytes(body);
      await writeFile(file, bytes);
      const object = (await headKey(key))!;
      return {
        ...object,
        contentType: bodyContentType(body, options?.contentType ?? object.contentType),
      };
    },

    async get(key: string) {
      const object = await headKey(key);
      if (!object) return null;
      const buffer = await readFile(resolve(key));
      return {
        object,
        bytes: new Uint8Array(
          buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        ),
      };
    },

    head: headKey,

    async delete(keys: string[]) {
      let deleted = 0;
      for (const key of keys) {
        const file = resolve(key);
        if (!(await headKey(key))) continue;
        await rm(file, { force: true });
        await pruneEmptyParents(file);
        deleted += 1;
      }
      return deleted;
    },

    async list(options: ListOptions = {}): Promise<ListResult> {
      const prefix = options.prefix ?? "";
      // Walk the deepest directory that fully contains the prefix.
      const dirPart = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/") + 1) : "";
      const keys = (await walk(dirPart ? resolve(dirPart) : absoluteRoot)).filter((key) =>
        key.startsWith(prefix),
      );
      const describe = async (key: string) => (await headKey(key))!;
      if (!options.delimiter) {
        return { objects: await Promise.all(keys.map(describe)), prefixes: [] };
      }
      const { direct, prefixes } = groupByDelimiter(keys, prefix, options.delimiter);
      return { objects: await Promise.all(direct.map(describe)), prefixes };
    },

    async copy(from: string, to: string) {
      if (!(await headKey(from))) throw new Error(`Object not found: ${from}`);
      const target = resolve(to);
      await mkdir(path.dirname(target), { recursive: true });
      await fsCopy(resolve(from), target);
    },
  };
}
