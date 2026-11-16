// Module stand-ins for the `code` staging instance:
// - pi-ai's faux provider → faux.mjs (the fake model says the CAST lines);
// - the Code registry, as code.boot.ts asks for it → registry.ts (the real
//   registry plus the real Claude Code driver on an in-process worker whose
//   Agent SDK is scripted).
const FAUX = "@earendil-works/pi-ai/providers/faux";
const here = (file) => new URL(file, import.meta.url).href;

export async function resolve(specifier, context, next) {
  const from = context.parentURL ?? "";
  if (specifier === FAUX && !from.includes("/stage-code-server/")) {
    return { url: here("./faux.mjs"), shortCircuit: true };
  }
  // tsx may already have added the extension by the time this hook runs.
  if (
    /^\.\/code\.registry(\.ts)?$/.test(specifier) &&
    from.endsWith("/server/api/code/code.boot.ts")
  ) {
    return next(here("./registry.ts"), context);
  }
  return next(specifier, context);
}
