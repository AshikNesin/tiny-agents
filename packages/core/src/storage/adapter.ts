/**
 * The storage contract. Three implementations ship: the local filesystem for
 * Node (`./node`), an R2 bucket binding for Workers (`./r2`), and an in-memory
 * map for tests (`./memory`). Keys are `/`-separated object paths; "folders"
 * are just common prefixes, like on any object store.
 */

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

export interface ListOptions {
  prefix?: string;
  /** With "/" the result is one folder level: objects plus sub-prefixes. Omit to list every key under `prefix`. */
  delimiter?: string;
  cursor?: string;
  limit?: number;
}

export interface ListResult {
  objects: StoredObject[];
  /** Sub-folders (only when `delimiter` was given), each ending with the delimiter. */
  prefixes: string[];
  /** Present when more results exist. */
  cursor?: string;
}

export interface StorageAdapter {
  readonly name: string;
  put(key: string, body: StorageBody, options?: PutOptions): Promise<StoredObject>;
  /** The object and its bytes, or null when the key does not exist. */
  get(key: string): Promise<{ object: StoredObject; bytes: Uint8Array<ArrayBuffer> } | null>;
  head(key: string): Promise<StoredObject | null>;
  /** Delete the given keys; missing keys are ignored. Returns how many existed. */
  delete(keys: string[]): Promise<number>;
  list(options?: ListOptions): Promise<ListResult>;
  copy(from: string, to: string): Promise<void>;
}

/** Normalise any accepted body into bytes. */
export async function bodyToBytes(body: StorageBody): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof body === "string") return new Uint8Array(new TextEncoder().encode(body));
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(body);
}

/** Content type hint from the body when the caller gave none. */
export function bodyContentType(body: StorageBody, explicit?: string): string {
  if (explicit) return explicit;
  if (body instanceof Blob && body.type) return body.type;
  return "application/octet-stream";
}

/** Split a flat key list into one folder level under `prefix`. */
export function groupByDelimiter(
  keys: string[],
  prefix: string,
  delimiter: string,
): { direct: string[]; prefixes: string[] } {
  const direct: string[] = [];
  const prefixes = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const index = rest.indexOf(delimiter);
    if (index === -1) direct.push(key);
    else prefixes.add(prefix + rest.slice(0, index + delimiter.length));
  }
  return { direct, prefixes: [...prefixes].sort() };
}
