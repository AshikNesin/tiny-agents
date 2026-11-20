export type StorageBody = Uint8Array | ArrayBuffer | Blob | string;

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date | null;
}

export interface PutOptions {
  contentType?: string;
}

export const MAX_LIST_LIMIT = 1000;

export interface ListOptions {
  prefix?: string;
  delimiter?: string;
  cursor?: string;
  limit?: number;
}

export interface ListResult {
  objects: StoredObject[];
  prefixes: string[];
  cursor?: string;
}

export interface StorageAdapter {
  readonly name: string;
  put(key: string, body: StorageBody, options?: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<{ object: StoredObject; bytes: Uint8Array<ArrayBuffer> } | null>;
  head(key: string): Promise<StoredObject | null>;
  delete(keys: string[]): Promise<void>;
  list(options?: ListOptions): Promise<ListResult>;
  copy(from: string, to: string): Promise<void>;
}

export async function bodyToBytes(body: StorageBody): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof body === "string") return new Uint8Array(new TextEncoder().encode(body));
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(body);
}

export function bodyContentType(body: StorageBody, explicit?: string): string {
  if (explicit) return explicit;
  if (body instanceof Blob && body.type) return body.type;
  return "application/octet-stream";
}

export function listKeys(
  keys: Iterable<string>,
  options: ListOptions = {},
): { keys: string[]; prefixes: string[]; cursor?: string } {
  const prefix = options.prefix ?? "";
  const { delimiter, cursor } = options;
  const requested = options.limit ?? MAX_LIST_LIMIT;
  if (!(requested >= 1)) throw new RangeError(`list limit must be at least 1, got ${requested}`);
  const limit = Math.min(Math.floor(requested), MAX_LIST_LIMIT);
  const isPrefix = new Map<string, boolean>();
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const index = delimiter ? key.indexOf(delimiter, prefix.length) : -1;
    if (index === -1) isPrefix.set(key, false);
    else isPrefix.set(key.slice(0, index + delimiter!.length), true);
  }
  const remaining = [...isPrefix.keys()]
    .filter((entry) => cursor === undefined || entry > cursor)
    .sort();
  const page = remaining.slice(0, limit);
  return {
    keys: page.filter((entry) => !isPrefix.get(entry)),
    prefixes: page.filter((entry) => isPrefix.get(entry)),
    cursor: remaining.length > page.length ? page.at(-1) : undefined,
  };
}
