# No release: remove dead code

`boundHost` in `packages/claude-worker/src/server.ts` was described as a test
seam, but no test used it and the package entry points (`.` and `./client`)
never exported it, so no consumer could import it. The same change removes
unused app code under `apps/web/src`. Behaviour is unchanged and no published
package is affected.
