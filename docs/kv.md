# Key-value store

A JSON key-value API over the `kv` table (`packages/core/src/kv/index.ts`). It
runs wherever the database runs (better-sqlite3 on Node, D1 on Workers) and
needs no extra service. The boilerplate uses it for app settings
(`APP_SETTING:` namespace) and passkey challenges (`passkey:challenge:`
namespace, five-minute TTL, consumed on first use).

## API

```ts
import { kv, createNamespaceKv, purgeExpiredKv } from "@groot/core/kv";

await kv.set("feature:flags", { beta: true });
await kv.set("otp:123", "482913", 5 * 60 * 1000); // third argument: ttlMs
const flags = await kv.get<{ beta: boolean }>("feature:flags");
await kv.has("otp:123");
await kv.delete("otp:123"); // → true when a row was removed
await kv.list("feature:"); // → [{ key, value }]
await kv.clear("feature:"); // → number of rows deleted

const cache = createNamespaceKv("cache"); // keys stored as "cache:<key>", returned without the prefix
await cache.set("users", [...], 60_000);
```

| Method                    | Behaviour                                                               |
| ------------------------- | ----------------------------------------------------------------------- |
| `get(key)`                | `undefined` when missing or expired (an expired row is deleted on read) |
| `set(key, value, ttlMs?)` | Upsert; the value is `JSON.stringify`-ed                                |
| `has(key)`                | `get(key) !== undefined`                                                |
| `delete(key)`             | `true` when a row existed                                               |
| `list(prefix?)`           | Live entries whose key starts with `prefix` (`_`/`%` are escaped)       |
| `clear(prefix?)`          | Delete every key with the prefix; returns the count                     |

## Expiry

`expiresAt` is enforced on read and swept by `purgeExpiredKv()`, which the job
tick's housekeeping runs every ten minutes (Node poller or Workers cron).
Nothing to configure.

## Schema

```ts
// packages/core/src/database/schema.ts
export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
});
```

## When to use it

Settings, short-lived tokens and challenges, small caches. Use a real table for
relational data, and avoid high-frequency counters on the Workers free plan
(D1 allows 100k row writes per day). This is a table in your SQLite/D1
database, not Workers KV.
