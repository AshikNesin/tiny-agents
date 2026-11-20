const FAUX = "@earendil-works/pi-ai/providers/faux";
const here = (file) => new URL(file, import.meta.url).href;

export async function resolve(specifier, context, next) {
  const from = context.parentURL ?? "";
  if (specifier === FAUX && !from.includes("/stage-code-server/")) {
    return { url: here("./faux.mjs"), shortCircuit: true };
  }
  if (
    /^\.\/code\.registry(\.ts)?$/.test(specifier) &&
    from.endsWith("/server/api/code/code.boot.ts")
  ) {
    return next(here("./registry.ts"), context);
  }
  return next(specifier, context);
}
