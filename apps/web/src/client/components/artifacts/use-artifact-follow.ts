import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../lib/chat-types";
import { latestArtifactCall } from "../../lib/artifact-view";
import { useArtifactPanel } from "../../store/artifacts";

export function useArtifactFollow(
  botId: string,
  messages: readonly ChatMessage[],
  loaded: boolean,
) {
  const latest = latestArtifactCall(messages);
  const key = latest ? `${latest.id}:${latest.seq}` : "";
  const seen = useRef<string | undefined>(undefined);
  const show = useArtifactPanel((s) => s.show);
  const close = useArtifactPanel((s) => s.close);

  useEffect(() => {
    seen.current = undefined;
    close();
  }, [botId, close]);

  useEffect(() => {
    if (!loaded) return;
    if (seen.current === undefined) {
      seen.current = key;
      return;
    }
    if (seen.current === key || !latest) return;
    seen.current = key;
    show({ artifactId: latest.id, seq: latest.seq });
  }, [loaded, key, latest, show]);
}
