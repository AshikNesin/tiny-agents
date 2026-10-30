# File storage

A small file browser (list, upload, download, delete, folders, rename) over a
storage adapter. Three adapters ship; the runtime entry injects one through
`bootstrap({ storage })` and the rest of the code uses `storage` from
`@groot/core/storage`.

| Adapter                                  | File                                  | Used by                                                                                                                             |
| ---------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `localStorage(root = "./local/uploads")` | `packages/core/src/storage/node.ts`   | `entry.node.ts` — plain files on disk, content type from the extension, empty folders pruned on delete, keys cannot escape the root |
| `r2Storage(env.STORAGE)`                 | `packages/core/src/storage/r2.ts`     | `entry.worker.ts` — an R2 bucket binding; no credentials, no SDK                                                                    |
| `memoryStorage()`                        | `packages/core/src/storage/memory.ts` | `tests/server/setup.ts`                                                                                                             |

Keys are `/`-separated object paths. Folders are common prefixes, as on any
object store; "creating" a folder writes a `<folder>/.keep` marker.

## The contract (`packages/core/src/storage/adapter.ts`)

```ts
interface StorageAdapter {
  readonly name: string;
  put(
    key: string,
    body: Uint8Array | ArrayBuffer | Blob | string,
    options?: { contentType?: string },
  ): Promise<StoredObject>;
  get(key: string): Promise<{ object: StoredObject; bytes: Uint8Array } | null>;
  head(key: string): Promise<StoredObject | null>;
  delete(keys: string[]): Promise<number>; // missing keys are ignored; returns how many existed
  list(options?: {
    prefix?: string;
    delimiter?: string;
    cursor?: string;
    limit?: number;
  }): Promise<ListResult>;
  copy(from: string, to: string): Promise<void>;
}
// StoredObject = { key, size, contentType, lastModified: Date | null }
// ListResult   = { objects: StoredObject[]; prefixes: string[]; cursor?: string }
```

With `delimiter: "/"`, `list()` returns one folder level: the objects directly
under `prefix` plus the sub-prefixes. Without it, every key under `prefix`.

Need S3, GCS or anything else? Implement these six methods (the helpers
`bodyToBytes`, `bodyContentType` and `groupByDelimiter` in `adapter.ts` do the
boring parts) and pass the result to `bootstrap()` in your entry file. Nothing
else changes.

## Using it from code

```ts
import { storage } from "@groot/core/storage";

await storage.put("reports/2026-10.csv", csvText, { contentType: "text/csv" });
const found = await storage.get("reports/2026-10.csv"); // { object, bytes } or null
const page = await storage.list({ prefix: "reports/", delimiter: "/" });
await storage.delete(["reports/2026-10.csv"]);
```

The higher-level operations the routes use (sorted folder listing, bulk upload,
rename as copy + delete, recursive folder delete) are in `storage.service.ts`.

## Module structure

```
packages/core/src/storage/
├── adapter.ts            # StorageAdapter contract + helpers
├── storage.ts            # the `storage` proxy, setStorageAdapter(), getStorage()
├── node.ts · r2.ts · memory.ts
├── storage.routes.ts     # Hono router (JWT, rate-limited, 100 MB upload limit)
├── storage.service.ts    # listFiles, uploadFile, bulkUpload, downloadFile, deleteFiles,
│                         # getFileMetadata, createFolder, deleteFolder, renameFile, copyFile
├── storage.schema.ts     # Zod schemas
└── storage.utils.ts      # getContentType(), sanitizeFileName()
```

## HTTP API

All under `/api/v1/storage`, JWT required, `storageRateLimiter` (100 requests /
15 min per IP). Uploads also pass `uploadRateLimiter` (50 / 15 min) and a
100 MB body limit.

| Method | Path                               | Notes                                                                                             |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/files?prefix=docs/&delimiter=/`  | One folder level, folders first then files. An empty `delimiter` lists every key under the prefix |
| POST   | `/files/upload` _(multipart)_      | Field `file`; optional `filePath` (defaults to the file name) and `contentType`                   |
| POST   | `/files/bulk-upload` _(multipart)_ | Field `files`, up to 50; returns `{ uploadedFiles, failedFiles }`                                 |
| GET    | `/files/download?filePath=…`       | Raw bytes with the object's content type, `Content-Disposition: inline`                           |
| GET    | `/files/metadata?filePath=…`       | `{ exists, size?, lastModified?, fileName }`                                                      |
| DELETE | `/files`                           | Body `{ "filePaths": [...] }` → `{ deletedCount }`                                                |
| POST   | `/folders`                         | Body `{ "folderPath": "docs/2026/" }` (must end with `/`)                                         |
| DELETE | `/folders/:folderPath`             | Deletes every object under the prefix → `{ deletedCount }`                                        |
| PUT    | `/files/rename`                    | Body `{ oldPath, newPath }` → `{ newPath }`                                                       |

Every JSON route returns `200` with the `{ success, data }` envelope. curl
examples in [API requests](../examples/api-requests.md#storage-jwt).

## Runtime notes

- **Node**: files live under `./local/uploads` relative to the working
  directory (git-ignored). In production they default to `/data/uploads`, next
  to the SQLite file (`uploadsRoot(env)` in `@groot/core/storage/node`); set
  `UPLOADS_DIR` to use another folder.
- **Workers**: the `STORAGE` R2 binding in `wrangler.jsonc`. Bucket bindings
  have no signed URLs, so downloads always stream through the API. The free
  plan includes 10 GB.
- **Tests**: `memoryStorage()`; nothing touches the disk.

## Frontend

`packages/shell/src/pages/storage/` renders the `/storage` page (breadcrumbs,
single and bulk uploads, folder dialog, rename, delete) with React Query hooks
in `pages/storage/hooks/useStorage.ts`.

## Troubleshooting

- **429** — rate limits; tune `config.rateLimits.storage` / `.upload`.
- **413 on upload** — larger than 100 MB (`MAX_UPLOAD_BYTES` in `storage.routes.ts`).
- **"Storage is not configured"** — the entry did not pass `storage` to
  `bootstrap()`; on Workers that means the `STORAGE` binding is missing.
- **Download prints binary** — it streams raw bytes; use `curl -o file`.
