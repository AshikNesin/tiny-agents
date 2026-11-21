import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
  copyFile as fsCopy,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  bodyToBytes,
  listKeys,
  type ListOptions,
  type ListResult,
  type StorageAdapter,
  type StorageBody,
  type StoredObject,
} from "./adapter";
import { getContentType } from "./storage.utils";
import { resolveSqlitePath } from "../database/node";
import type { Env } from "../env";

export const LOCAL_UPLOADS_ROOT = "./local/uploads";

export function uploadsRoot(
  env: Pick<Env, "NODE_ENV" | "DATABASE_URL"> & { UPLOADS_DIR?: string },
): string {
  if (env.UPLOADS_DIR) return env.UPLOADS_DIR;
  if (env.NODE_ENV !== "production") return LOCAL_UPLOADS_ROOT;
  const file = resolveSqlitePath(env.DATABASE_URL);
  return file === ":memory:" ? LOCAL_UPLOADS_ROOT : path.join(path.dirname(file), "uploads");
}

export function localStorage(root: string = LOCAL_UPLOADS_ROOT): StorageAdapter {
  const absoluteRoot = path.resolve(root);

  const resolve = (key: string): string => {
    const target = path.resolve(absoluteRoot, key);
    if (target !== absoluteRoot && !target.startsWith(absoluteRoot + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return target;
  };

  const pruneEmptyParents = async (file: string): Promise<void> => {
    let dir = path.dirname(file);
    while (dir.startsWith(absoluteRoot + path.sep)) {
      try {
        await rmdir(dir);
      } catch {
        return;
      }
      dir = path.dirname(dir);
    }
  };

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
    return keys;
  };

  const headKey = async (key: string): Promise<StoredObject | null> => {
    const file = resolve(key);
    try {
      const info = await stat(file);
      if (!info.isFile()) return null;
      return { key, size: info.size, contentType: getContentType(key), lastModified: info.mtime };
    } catch {
      return null;
    }
  };

  return {
    name: "local",

    async put(key: string, body: StorageBody) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, await bodyToBytes(body));
        await rename(temp, file);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      return (await headKey(key))!;
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
      for (const key of keys) {
        if (!(await headKey(key))) continue;
        const file = resolve(key);
        await rm(file, { force: true });
        await pruneEmptyParents(file);
      }
    },

    async list(options: ListOptions = {}): Promise<ListResult> {
      const prefix = options.prefix ?? "";
      const dirPart = prefix.slice(0, prefix.lastIndexOf("/") + 1);
      const page = listKeys(await walk(dirPart ? resolve(dirPart) : absoluteRoot), options);
      const objects = await Promise.all(page.keys.map(async (key) => (await headKey(key))!));
      return { objects, prefixes: page.prefixes, cursor: page.cursor };
    },

    async copy(from: string, to: string) {
      if (!(await headKey(from))) throw new Error(`Object not found: ${from}`);
      const target = resolve(to);
      await mkdir(path.dirname(target), { recursive: true });
      await fsCopy(resolve(from), target);
    },
  };
}
