/**
 * "Import" dialog (issue #1 M2): paste a SKILL.md or point at a GitHub skill
 * folder, preview the parse, then install. Review happens in the same dialog —
 * Back returns to the input step, Install POSTs the parsed fields.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@groot/ui/dialog";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Textarea } from "@groot/ui/textarea";
import { Label } from "@groot/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@groot/ui/tabs";
import { DataField, DataFields } from "@groot/ui/display";
import { Streamdown } from "streamdown";
import { skillsApi, type Skill, type SkillPreview } from "../../lib/skills-api";
import { SkillFileList } from "./SkillFileList";

type Mode = "paste" | "github";

const PASTE_PLACEHOLDER = `---
name: my-skill
description: What this skill does and when to load it
---

Instructions in markdown…`;

export function ImportSkillDialog({
  open,
  onOpenChange,
  onInstalled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: (skill: Skill) => void;
}) {
  const [mode, setMode] = useState<Mode>("paste");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("paste");
      setContent("");
      setUrl("");
      setPreview(null);
      setLoading(false);
      setInstalling(false);
    }
  }, [open]);

  const submit = async () => {
    setLoading(true);
    try {
      const parsed =
        mode === "paste"
          ? await skillsApi.preview({ source: "paste", content })
          : await skillsApi.preview({ source: "github", url: url.trim() });
      setPreview(parsed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to preview skill");
    } finally {
      setLoading(false);
    }
  };

  const install = async () => {
    if (!preview) return;
    setInstalling(true);
    try {
      const skill = await skillsApi.create({
        name: preview.name,
        description: preview.description,
        body: preview.body,
        files: preview.files,
        ...(preview.sourceUrl ? { source: "url", sourceUrl: preview.sourceUrl } : {}),
      });
      toast.success("Skill installed");
      onOpenChange(false);
      onInstalled(skill);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to install skill");
    } finally {
      setInstalling(false);
    }
  };

  const canSubmit = mode === "paste" ? content.trim().length > 0 : url.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>
            {preview
              ? "Review the parsed skill before installing."
              : "Bring in a skill from pasted SKILL.md content or a GitHub link."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {preview ? (
            <div className="space-y-4">
              <DataFields columns={2}>
                <DataField label="Name">{preview.name}</DataField>
                <DataField label="Files">{preview.files.length}</DataField>
                <div className="col-span-2">
                  <DataField label="Description">{preview.description}</DataField>
                </div>
              </DataFields>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                <div className="rounded-lg border p-4 text-sm">
                  {preview.body.trim() ? (
                    <Streamdown>{preview.body}</Streamdown>
                  ) : (
                    <p className="text-muted-foreground text-sm">No instructions body.</p>
                  )}
                </div>
                <SkillFileList files={preview.files} />
              </div>
              {preview.warnings.length > 0 && (
                <ul className="space-y-1.5">
                  {preview.warnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-2 text-xs text-warning">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                      {warning}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="paste">Paste</TabsTrigger>
                <TabsTrigger value="github">GitHub URL</TabsTrigger>
              </TabsList>
              <TabsContent value="paste" className="mt-4">
                <div className="space-y-2">
                  <Label htmlFor="import-content">SKILL.md content</Label>
                  <Textarea
                    id="import-content"
                    rows={10}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={PASTE_PLACEHOLDER}
                    className="font-mono"
                  />
                  <p className="text-muted-foreground text-xs">
                    Needs frontmatter with a name and a description.
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="github" className="mt-4">
                <div className="space-y-2">
                  <Label htmlFor="import-url">GitHub URL</Label>
                  <Input
                    id="import-url"
                    type="url"
                    value={url}
                    maxLength={2000}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo/tree/main/skills/my-skill"
                  />
                  <p className="text-muted-foreground text-xs">
                    A link to a public skill folder or its SKILL.md.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogBody>

        <DialogFooter>
          {preview ? (
            <>
              <Button variant="outline" onClick={() => setPreview(null)}>
                Back
              </Button>
              <Button
                onClick={() => void install()}
                disabled={installing || preview.exists}
                title={preview.exists ? "A skill with this name already exists" : undefined}
              >
                Install
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} disabled={!canSubmit || loading}>
                {loading ? "Previewing…" : "Preview"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
