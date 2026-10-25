const FAUX = "@earendil-works/pi-ai/providers/faux";
export async function resolve(specifier, context, next) {
  if (specifier === FAUX && !context.parentURL?.includes("/scripts/demo/")) {
    return { url: new URL("./faux-director.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
