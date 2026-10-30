/** Requests for build output (never an app route): /assets/* and common static files. */
export function isAssetRequest(urlPath: string): boolean {
  return (
    urlPath.startsWith("/assets/") ||
    /\.(?:js|mjs|css|map|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico|json|txt|webmanifest|wasm)$/i.test(
      urlPath,
    )
  );
}
