# Running locally with updates (`pnpm local`)

On a machine that can't use a hosted deploy, such as a work laptop, run
tiny-agents with `pnpm local` instead of `pnpm build` and `pnpm start`. It
keeps the server running, checks git for new commits, and builds them while
the old version keeps serving. You update from **Settings → Updates** with
one click and the page reloads on the new version. You no longer pull,
build, stop and start by hand.

The idea comes from [Shelley](https://github.com/boldsoftware/shelley), which
checks for a new release, swaps its binary in place and restarts itself from
its UI. tiny-agents has no single binary, so the release it swaps in is a
built git worktree.

```bash
pnpm local
```

The first run builds the latest commit (a few minutes). Later runs start the
last built version straight away.

## How it works

```
pnpm local  (supervisor, scripts/local.ts; cwd = this checkout)
  │  fork + IPC, NODE_ENV=production
  ▼
node ~/.tiny-agents/releases/<sha>/dist/server/bundle.js
  ├─ reads .env and data/ from this checkout, as `pnpm start` does
  └─ Settings → Updates  ⇄  /api/v1/system/update  ⇄  IPC  ⇄  supervisor
```

1. **Check.** One check runs 10 seconds after start, then one every hour, and
   one whenever you press **Check now**. A check runs `git fetch` on the
   tracked ref and lists the new commits.
2. **Build beside the running server.** **Update & restart** checks out the
   new commit as a detached worktree in `~/.tiny-agents/releases/<sha>`, then
   runs `pnpm install --frozen-lockfile` and `pnpm build` there. Packages come
   from the pnpm store as hard links, so a release costs little disk. The
   running server is not touched, and a failed build leaves it running and
   shows the build output.
3. **Swap.** The old server stops gracefully (`SIGTERM`), and the new one
   starts with this checkout as its working directory. It applies any new
   migrations on boot. Replies that were in progress resume, because the
   agent store is durable.
4. **Roll back.** If the new server exits, or neither reports ready nor
   answers `/ready` within 5 minutes, the previous release starts again and
   Settings → Updates shows why.
5. **Keep two.** After a successful update, only the new release and the one
   before it are kept. `~/.tiny-agents/releases/current` names the release
   that runs.

The supervisor also restarts a server that crashes, waiting 1 s, 2 s, 4 s and
so on up to 30 s between attempts.

## Options

| Flag                  | Default | What it does                                                    |
| --------------------- | ------- | --------------------------------------------------------------- |
| `--track <branch>`    | `main`  | The branch to follow on the remote                              |
| `--track release`     |         | Follow the newest `v*` release tag instead (fewer, versioned)   |
| `--remote <name>`     | origin  | The git remote to fetch from                                    |
| `--auto`              | off     | Update as soon as a check finds a new commit, without the click |
| `--check-every <min>` | `60`    | Minutes between checks; `0` checks only when you ask            |

`TINY_AGENTS_RELEASES_DIR` moves the releases folder away from
`~/.tiny-agents/releases`.

To run it in the background, use whatever keeps a terminal command alive on
your machine: a `tmux` session, `nohup pnpm local &`, or a launchd or systemd
user unit whose command is `pnpm local` in this folder. Stop it with Ctrl+C
or `SIGTERM`. A second Ctrl+C exits immediately.

## The local sandbox

The [local sandbox](./local-sandbox.md) container runs on its own under
Docker (`restart: unless-stopped`), so an update does not touch it. When an
update changes `docker/sandbox/`, Settings → Updates says so. Run
`pnpm sandbox:up` from this checkout after updating to rebuild the image.

## Notes

- **Your checkout is not changed.** Releases are separate worktrees, so local
  edits and branches in this folder are never touched. To update
  `scripts/local.ts` itself, run `git pull` here and restart `pnpm local`.
- **Credentials.** `git fetch` runs as you, so it uses the credentials
  `git pull` already uses on this machine.
- **Rolling back across a migration.** A rollback runs the previous code
  against a database that the new release may already have migrated.
  Migrations here add columns and tables, so that usually works. If it does
  not, fix forward.
- **`pnpm start` still works.** A server started any other way shows how to
  turn updates on in Settings → Updates, and the update API answers `409`.
