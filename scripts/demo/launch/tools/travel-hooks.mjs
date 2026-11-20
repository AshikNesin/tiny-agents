const FAUX = "@earendil-works/pi-ai/providers/faux";
const DIRECTOR = new URL("./travel-director.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === FAUX && context.parentURL !== DIRECTOR) {
    return { url: DIRECTOR, shortCircuit: true };
  }
  return next(specifier, context);
}
