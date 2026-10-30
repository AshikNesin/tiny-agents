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

interface Entry {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  lastModified: Date;
}

/** In-memory storage for tests and quick experiments. */
export function memoryStorage(): StorageAdapter {
  const objects = new Map<string, Entry>();
  const toObject = (key: string, entry: Entry): StoredObject => ({
    key,
    size: entry.bytes.byteLength,
    contentType: entry.contentType,
    lastModified: entry.lastModified,
  });

  return {
    name: "memory",

    async put(key: string, body: StorageBody, options?: PutOptions) {
      const entry: Entry = {
        bytes: await bodyToBytes(body),
        contentType: bodyContentType(body, options?.contentType),
        lastModified: new Date(),
      };
      objects.set(key, entry);
      return toObject(key, entry);
    },

    async get(key: string) {
      const entry = objects.get(key);
      return entry ? { object: toObject(key, entry), bytes: entry.bytes } : null;
    },

    async head(key: string) {
      const entry = objects.get(key);
      return entry ? toObject(key, entry) : null;
    },

    async delete(keys: string[]) {
      let deleted = 0;
      for (const key of keys) if (objects.delete(key)) deleted += 1;
      return deleted;
    },

    async list(options: ListOptions = {}): Promise<ListResult> {
      const prefix = options.prefix ?? "";
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      if (!options.delimiter) {
        return { objects: keys.map((key) => toObject(key, objects.get(key)!)), prefixes: [] };
      }
      const { direct, prefixes } = groupByDelimiter(keys, prefix, options.delimiter);
      return { objects: direct.map((key) => toObject(key, objects.get(key)!)), prefixes };
    },

    async copy(from: string, to: string) {
      const entry = objects.get(from);
      if (!entry) throw new Error(`Object not found: ${from}`);
      objects.set(to, { ...entry, lastModified: new Date() });
    },
  };
}
