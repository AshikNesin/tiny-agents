import { useState } from "react";
import { Copy, Download, History, X } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@groot/ui";
import type { ArtifactDetail, ArtifactVersion } from "../../../shared/api/artifacts";
import { artifactFile, fenced, runsInFrame, sourceLanguage } from "../../lib/artifact-view";
import { copyText } from "../../lib/clipboard";
import { errorMessage } from "../../lib/errors";
import { Markdown } from "../../lib/markdown";
import { useArtifact, useArtifactVersion, useRestoreArtifact } from "../../queries/artifacts";
import { useRefreshOn } from "../../queries/resource";
import { useArtifactPanel } from "../../store/artifacts";
import { CodeBlock, CodeBlockContent, CodeBlockLine } from "../ui/code-block";
import { useHighlightedCode } from "../ui/hooks/use-highlighted-code";
import { ArtifactFrame } from "./ArtifactFrame";

type View = "preview" | "source";

const PANEL_SIZING =
  "fixed inset-0 z-40 bg-background xl:static xl:z-auto xl:h-full xl:w-[min(44rem,calc(100vw-42rem))] xl:shrink-0 xl:bg-transparent xl:p-2 xl:pl-0";

const OP_LABEL: Record<ArtifactVersion["op"], string> = {
  create: "created",
  edit: "edited",
  rewrite: "rewritten",
  restore: "restored",
};

export function ArtifactPanel({ botId, owner }: { botId: string; owner: boolean }) {
  const open = useArtifactPanel((s) => s.open);
  const show = useArtifactPanel((s) => s.show);
  const close = useArtifactPanel((s) => s.close);
  if (!open) return null;
  return (
    <ArtifactPanelBody
      key={open.artifactId}
      botId={botId}
      artifactId={open.artifactId}
      requestedSeq={open.seq}
      owner={owner}
      onShow={(seq) => show({ artifactId: open.artifactId, seq })}
      onClose={close}
    />
  );
}

function ArtifactPanelBody({
  botId,
  artifactId,
  requestedSeq,
  owner,
  onShow,
  onClose,
}: {
  botId: string;
  artifactId: string;
  requestedSeq: number;
  owner: boolean;
  onShow: (seq: number) => void;
  onClose: () => void;
}) {
  const detail = useArtifact(botId, artifactId);
  useRefreshOn(requestedSeq, detail.refresh);
  const [view, setView] = useState<View>("preview");
  const artifact = detail.status === "ready" ? detail.data : undefined;
  const seq = requestedSeq;
  const version = useArtifactVersion(botId, artifactId, seq);
  const restore = useRestoreArtifact(botId, artifactId);

  const doRestore = async () => {
    try {
      const restored = await restore.mutateAsync(seq);
      onShow(restored.headSeq);
      toast.success(`Restored version ${seq} as version ${restored.headSeq}`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not restore that version"));
    }
  };

  return (
    <div className={PANEL_SIZING} data-testid="artifact-panel">
      <Card size="sm" className="h-full min-h-0 gap-0 py-0 max-xl:rounded-none max-xl:ring-0">
        <div className="border-border flex items-center gap-2 border-b px-2 py-1.5">
          <CardTitle className="min-w-0 flex-1 truncate pl-1 text-sm">
            {artifact?.title ?? "Artifact"}
          </CardTitle>
          {artifact && <VersionPicker artifact={artifact} seq={seq} onPick={onShow} />}
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="source">Source</TabsTrigger>
            </TabsList>
          </Tabs>
          {version.status === "ready" && artifact && (
            <PanelActions artifact={artifact} content={version.data.content} />
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close artifact"
            title="Close artifact"
          >
            <X />
          </Button>
        </div>
        {artifact && owner && seq !== artifact.headSeq && (
          <div className="bg-muted text-muted-foreground flex items-center gap-2 px-3 py-1.5 text-xs">
            <History className="size-3.5" />
            <span className="flex-1">
              Viewing version {seq} of {artifact.headSeq}.
            </span>
            <Button size="xs" variant="secondary" disabled={restore.isPending} onClick={doRestore}>
              Restore as latest
            </Button>
          </div>
        )}
        <div className="relative min-h-0 flex-1 overflow-auto">
          {detail.status === "failed" ? (
            <p className="text-destructive p-4 text-sm">{detail.loadError}</p>
          ) : version.status === "failed" ? (
            <p className="text-destructive p-4 text-sm">{version.loadError}</p>
          ) : artifact && version.status === "ready" ? (
            view === "preview" ? (
              <ArtifactPreview artifact={artifact} version={version.data} />
            ) : (
              <ArtifactSource artifact={artifact} content={version.data.content} />
            )
          ) : (
            <p className="text-muted-foreground p-4 text-sm">Loading…</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function VersionPicker({
  artifact,
  seq,
  onPick,
}: {
  artifact: ArtifactDetail;
  seq: number;
  onPick: (seq: number) => void;
}) {
  return (
    <Select value={String(seq)} onValueChange={(value) => onPick(Number(value))}>
      <SelectTrigger size="sm" aria-label="Version" className="w-auto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {artifact.versions.map((v) => (
          <SelectItem key={v.seq} value={String(v.seq)}>
            v{v.seq} · {OP_LABEL[v.op]}
            {v.author === "owner" ? " by you" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PanelActions({ artifact, content }: { artifact: ArtifactDetail; content: string }) {
  const copy = async () => {
    if (await copyText(content)) toast.success("Copied");
  };
  const download = () => {
    const file = artifactFile(artifact.slug, artifact.kind, artifact.language);
    const url = URL.createObjectURL(new Blob([content], { type: file.mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy" title="Copy">
        <Copy />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={download}
        aria-label="Download"
        title="Download"
      >
        <Download />
      </Button>
    </>
  );
}

function ArtifactPreview({
  artifact,
  version,
}: {
  artifact: ArtifactDetail;
  version: ArtifactVersion;
}) {
  if (runsInFrame(artifact.kind)) {
    return <ArtifactFrame kind={artifact.kind} content={version.content} title={version.title} />;
  }
  const markdown =
    artifact.kind === "markdown"
      ? version.content
      : artifact.kind === "mermaid"
        ? fenced("mermaid", version.content)
        : fenced(artifact.language ?? "text", version.content);
  return (
    <div className="prose-chat p-4 text-sm" data-testid="artifact-preview">
      <Markdown>{markdown}</Markdown>
    </div>
  );
}

function ArtifactSource({ artifact, content }: { artifact: ArtifactDetail; content: string }) {
  const lines = useHighlightedCode(content, sourceLanguage(artifact.kind, artifact.language));
  return (
    <CodeBlock size="sm" className="m-2" data-testid="artifact-source">
      <CodeBlockContent wrap>
        {lines.map((line, i) => (
          <CodeBlockLine key={i}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}
