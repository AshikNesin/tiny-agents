# Memory audit: probes, findings, and fix

Branch `ta/fix-memory-leak` (base `main`). Goal: find and fix the largest measurable memory leak; prove it with before/after numbers.

## Verdict

One real unbounded-growth path found and fixed: **SSE response bodies buffer without bound when the consumer stops reading**. Everything else probed was flat.

## Environment

- Node v24.11.1, Linux (sandbox), `NODE_ENV=test`, vitest server config, fake agent runtime
- Memory metric: `process.memoryUsage()` (`arrayBuffers` for retained frame buffers), forced GC (`--expose-gc`) before every measurement
- Probes are committed as tests: `tests/server/probe-backpressure.test.ts` (volume probe) and `tests/server/api/bots/sse-backpressure.test.ts` (regression + delivery)

## The leak: SSE writes with a stalled consumer

`openSse` (`apps/web/src/server/api/bots/bots.sse.ts`) pushed every event into the response `ReadableStream` unconditionally. A default-controller stream applies no backpressure to a push-based writer, so a suspended tab / dead proxy / dropped connection caused unbounded retention (verified via heap snapshot: thousands of frame `ArrayBuffer`s retained under the stream controller's queue).

Probe: open `/api/v1/bots/:id/stream`, never read the body, publish `routine-run` events with 10 KB outputs.

| stalled consumer     | before fix                      | after fix                   |
| -------------------- | ------------------------------- | --------------------------- |
| 1,000 × 10 KB events | +10 MB, stream still open       | stream dropped at 2 MB cap  |
| 5,000 × 10 KB events | **+48.8 MB, stream still open** | **−0.9 MB, stream dropped** |
| repeat 2,000 / 5,000 | keeps growing linearly          | 0.0 MB growth               |

Per-user cap is 20 streams, so 20 stalled tabs per user could previously retain unbounded memory each; worst case is now 20 × ~2 MB.

Fix: the body is now a byte stream (`type: "bytes"`) with a 2 MB `highWaterMark`; `write()` checks `controller.desiredSize` and ends the stream when the consumer is more than 2 MB behind. The web client already auto-reconnects on stream drop. Delivery to reading clients is regression-tested (100 × 10 KB burst delivered in order, stream stays open).

Note on probing methodology: a socket-level "paused client" on loopback is not sufficient to reproduce this — the kernel absorbs tens of MB on loopback. The deterministic reproduction is an in-process request whose body is never read, which is exactly the state the server is in once the node adapter awaits socket `drain`.

## Paths probed and found flat

| path                                       | iterations   | heap                                    | retained structures                              |
| ------------------------------------------ | ------------ | --------------------------------------- | ------------------------------------------------ |
| server SSE open/close (`/bots/:id/stream`) | 400          | 113.7 → 114.8 MB                        | streams/listeners/liveAccess all 0 after close   |
| events feed SSE (`/api/v1/events`)         | 400          | 115.4 → 115.8 MB                        | 0                                                |
| upload extraction round-trips              | 30           | 114.7 → 115.3 MB                        | LRU cache bounded                                |
| client ChatPane mount/unmount (jsdom)      | 200          | 90.7 → 100.0 MB (flat after warmup)     | 0 leaked listeners; sessions cache is deliberate |
| backpressure socket buffers (loopback)     | 5,000 events | socket writable buffers stayed ≤ 0.1 MB | n/a                                              |

Static audit of every server-side `Map`/`Set`/listener/timer (app-root state, SSE finish paths, WS bridges, ticket store, notifications, rate-limit stores, secret redactor TTL, github token cache, uploads LRU) found correct cleanup on all of them.

## Not measured (no sandbox-safe way)

- Long-running production process idle drift (days), real browser tab suspension over a network, multi-worker process churn under load
- Browser-side heap via CDP: sandbox has no browser available

## Reproducing

```
NODE_OPTIONS="--expose-gc" NODE_ENV=test pnpm test tests/server/api/bots/sse-backpressure.test.ts
NODE_OPTIONS="--expose-gc" NODE_ENV=test pnpm test tests/server/probe-backpressure.test.ts
```
