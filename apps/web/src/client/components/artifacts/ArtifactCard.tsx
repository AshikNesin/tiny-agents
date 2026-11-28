import { FileCode2, FileText, GitBranch, Globe, Image, PanelRightOpen } from "lucide-react";
import { Button, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import type { ChatToolCall } from "../../lib/chat-types";
import { useArtifactPanel } from "../../store/artifacts";

const ICONS: Record<string, typeof FileText> = {
  markdown: FileText,
  code: FileCode2,
  html: Globe,
  svg: Image,
  mermaid: GitBranch,
};

const VERB: Record<string, string> = {
  create_artifact: "created",
  edit_artifact: "edited",
  rewrite_artifact: "rewritten",
};

export function ArtifactCard({
  call,
}: {
  call: ChatToolCall & { artifact: NonNullable<ChatToolCall["artifact"]> };
}) {
  const { artifact } = call;
  const show = useArtifactPanel((s) => s.show);
  const Icon = ICONS[artifact.kind] ?? FileText;
  return (
    <div
      className="border-border flex max-w-md min-w-0 items-center gap-3 rounded-2xl border px-3 py-2.5"
      data-testid="artifact-card"
    >
      <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-xl">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{artifact.title}</p>
        <p className={cn("text-muted-foreground truncate text-xs", monoClass)}>
          {artifact.kind} · v{artifact.seq} {VERB[call.name] ?? "saved"}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => show({ artifactId: artifact.id, seq: artifact.seq })}
      >
        Open
        <PanelRightOpen />
      </Button>
    </div>
  );
}
