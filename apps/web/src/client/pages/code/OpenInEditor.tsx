import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Input, Label, monoClass } from "@groot/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { cn } from "@groot/ui/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import { copyText } from "../../lib/clipboard";
import type { HarnessInfo } from "../../lib/code/api";
import {
  EDITORS,
  editorUrl,
  lastEditor,
  lastHost,
  rememberEditor,
  sshConfig,
  suggestedHost,
  type EditorId,
} from "../../lib/code/editor";

function CopyButton({ text, label, wide }: { text: string; label: string; wide?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size={wide ? "sm" : "icon-sm"}
      aria-label={label}
      title={label}
      onClick={() =>
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <Check /> : <Copy />}
      {wide && (copied ? "Copied" : label)}
    </Button>
  );
}

export function OpenInEditor({
  open,
  onOpenChange,
  harness,
  path,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  harness: HarnessInfo;
  path: string;
}) {
  const appHost = window.location.hostname;
  const suggested = suggestedHost(harness.ssh, appHost);
  const config = sshConfig(harness.ssh, appHost);
  const [editor, setEditor] = useState<EditorId>(lastEditor);
  const [host, setHost] = useState(() => lastHost(harness.id) ?? suggested);

  const target = host.trim();
  const url = target ? editorUrl(editor, target, path) : "";
  const label = EDITORS.find((e) => e.id === editor)?.label ?? "editor";
  const launch = () => {
    if (!url) return;
    rememberEditor(editor, harness.id, target);
    window.location.assign(url);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="code-open-editor">
        <DialogHeader>
          <DialogTitle>Open in editor</DialogTitle>
          <DialogDescription className={cn("truncate text-xs", monoClass)} title={path}>
            {path}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            launch();
          }}
        >
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={editor}
            onValueChange={(value) => value && setEditor(value as EditorId)}
            aria-label="Editor"
          >
            {EDITORS.map((e) => (
              <ToggleGroupItem key={e.id} value={e.id} className="px-3">
                {e.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code-editor-host">SSH host</Label>
            <Input
              id="code-editor-host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder={suggested}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              className={monoClass}
            />
            <p className="text-muted-foreground text-xs">
              A host, user@host, or a Host from your ~/.ssh/config.
            </p>
          </div>
          {config && target === suggested && (
            <div className="flex flex-col gap-1.5" data-testid="code-editor-ssh-config">
              <p className="text-muted-foreground text-xs">Add this to ~/.ssh/config once:</p>
              <div className="bg-muted relative rounded-md">
                <pre className={cn("overflow-x-auto p-3 pr-10 text-xs", monoClass)}>{config}</pre>
                <div className="absolute top-1.5 right-1.5">
                  <CopyButton text={config} label="Copy SSH config" />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="items-center sm:justify-between">
            <span className="flex items-center gap-1">
              {url && <CopyButton text={url} label="Copy link" wide />}
            </span>
            <Button type="submit" disabled={!url} autoFocus>
              Open in {label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
