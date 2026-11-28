const ARTIFACT_FRAME_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

const SVG_PAGE_HEAD =
  '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}' +
  "body{display:flex;align-items:center;justify-content:center}" +
  "svg{max-width:100%;max-height:100%;height:auto}</style></head><body>";

const SHELL = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"></head><body><script>
(function () {
  var rendered = false;
  window.addEventListener("message", function (event) {
    if (rendered || event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.type !== "artifact.render" || typeof data.content !== "string") return;
    rendered = true;
    var page = data.kind === "svg" ? ${JSON.stringify(SVG_PAGE_HEAD)} + data.content + "</body></html>" : data.content;
    document.open();
    document.write(page);
    document.close();
  });
  window.parent.postMessage({ type: "artifact.ready" }, "*");
})();
</script></body></html>`;

export function artifactFrameResponse(): Response {
  return new Response(SHELL, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": ARTIFACT_FRAME_CSP,
      "Cache-Control": "public, max-age=300",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy":
        "camera=(), microphone=(), geolocation=(), usb=(), payment=(), clipboard-read=()",
    },
  });
}
