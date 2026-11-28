import { useEffect, useRef } from "react";
import type { ArtifactKind } from "../../../shared/api/artifacts";
import { ARTIFACT_FRAME_URL } from "../../lib/artifacts-api";

export function ArtifactFrame({
  kind,
  content,
  title,
}: {
  kind: ArtifactKind;
  content: string;
  title: string;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame || event.source !== frame) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null || !("type" in data)) return;
      if (data.type !== "artifact.ready") return;
      frame.postMessage({ type: "artifact.render", kind, content }, "*");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [kind, content]);

  return (
    <iframe
      key={`${kind}:${content.length}:${content.slice(0, 64)}`}
      ref={frameRef}
      src={ARTIFACT_FRAME_URL}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      title={title}
      className="size-full border-0 bg-white"
      data-testid="artifact-frame"
    />
  );
}
