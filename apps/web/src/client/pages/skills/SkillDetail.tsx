/**
 * Skill editor at /skills/:id (issue #1 M2). The name is the id-like slug bots
 * reference, so it stays read-only; description and body are editable, bot
 * assignment toggles PATCH immediately.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@groot/ui/breadcrumb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Textarea } from "@groot/ui/textarea";
import { Label } from "@groot/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@groot/ui/card";
import { Checkbox } from "@groot/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@groot/ui/tabs";
import { ErrorState } from "@groot/ui/empty-state";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { Section } from "@groot/shell/components/layout/Section";
import { Streamdown } from "streamdown";
import { skillsApi, type Skill } from "../../lib/skills-api";
import { botsApi, type BotListEntry } from "../../lib/bots-api";
import { SkillFileList } from "../../components/skills/SkillFileList";
import { LeaveGuard } from "../../components/LeaveGuard";

export function SkillDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [skill, setSkill] = useState<Skill | null>(null);
  const [bots, setBots] = useState<BotListEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ description: "", body: "" });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const loaded = await skillsApi.get(id);
      setSkill(loaded);
      setForm({ description: loaded.description, body: loaded.body });
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load skill");
    }
  }, [id]);

  useEffect(() => {
    setSkill(null);
    setLoadError(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    botsApi
      .list()
      .then((list) => !cancelled && setBots(list))
      .catch(() => !cancelled && setBots([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <PageLayout title="Skill" maxWidth="4xl" backTo="/skills">
        <ErrorState
          title="Couldn't load skill"
          description={loadError}
          action={
            <>
              <Button variant="outline" onClick={() => navigate("/skills")}>
                Back to skills
              </Button>
              <Button onClick={() => void refresh()}>Retry</Button>
            </>
          }
        />
      </PageLayout>
    );
  }

  if (!skill) {
    return (
      <PageLayout title="Skill" maxWidth="4xl" backTo="/skills">
        <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>
      </PageLayout>
    );
  }

  const dirty = form.description !== skill.description || form.body !== skill.body;

  const save = async () => {
    setSaving(true);
    try {
      const updated = await skillsApi.update(id, {
        description: form.description.trim(),
        body: form.body,
      });
      setSkill(updated);
      setForm({ description: updated.description, body: updated.body });
      toast.success("Skill saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save skill");
    } finally {
      setSaving(false);
    }
  };

  const toggleBot = async (botId: string) => {
    const previous = skill.botIds;
    const botIds = previous.includes(botId)
      ? previous.filter((b) => b !== botId)
      : [...previous, botId];
    setSkill({ ...skill, botIds });
    try {
      setSkill(await skillsApi.update(id, { botIds }));
    } catch (error) {
      setSkill((current) => (current ? { ...current, botIds: previous } : current));
      toast.error(error instanceof Error ? error.message : "Failed to update bots");
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await skillsApi.remove(id);
      toast.success("Skill deleted");
      navigate("/skills");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete skill");
      setDeleting(false);
    }
  };

  const usedBy = skill.botIds.length;

  const breadcrumb = (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink onClick={() => navigate("/skills")}>Skills</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbPage>{skill.name}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );

  return (
    <PageLayout
      title={skill.name}
      breadcrumb={breadcrumb}
      maxWidth="4xl"
      backTo="/skills"
      actions={
        <>
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            Save changes
          </Button>
        </>
      }
    >
      {/* Deleting navigates away on purpose; nothing left to keep. */}
      <LeaveGuard when={dirty && !deleting} />
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="skill-name">Name</Label>
            <Input id="skill-name" value={skill.name} disabled />
            <p className="text-muted-foreground text-xs">
              Bots reference a skill by its name, so it can't be changed.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="skill-description">Description</Label>
            <Input
              id="skill-description"
              value={form.description}
              maxLength={1024}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <p className="text-muted-foreground text-xs">
              Shown when the bot decides whether to load this skill.
            </p>
          </div>
        </CardContent>
      </Card>

      <Section title="Used by bots" meta={bots ? `${usedBy} of ${bots.length}` : undefined}>
        {bots === null ? (
          <p className="text-muted-foreground py-4 text-center text-sm">Loading…</p>
        ) : bots.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No bots yet — create a bot to assign this skill to it.
          </p>
        ) : (
          <div className="space-y-2">
            {usedBy === 0 && (
              <p className="text-muted-foreground text-sm">
                No bot loads this skill yet. Tick the bots that should have it.
              </p>
            )}
            {bots.map((bot) => {
              const enabled = skill.botIds.includes(bot.id);
              return (
                <div key={bot.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <Checkbox
                    id={`skill-bot-${skill.id}-${bot.id}`}
                    className="mt-0.5"
                    checked={enabled}
                    onCheckedChange={() => void toggleBot(bot.id)}
                    aria-label={`Use ${skill.name} with ${bot.name}`}
                  />
                  <label
                    htmlFor={`skill-bot-${skill.id}-${bot.id}`}
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <span className="block truncate text-sm font-medium">{bot.name}</span>
                    <span className="text-muted-foreground mt-0.5 line-clamp-1 block text-xs">
                      {bot.description}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="edit">
            <TabsList>
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <TabsContent value="edit" className="mt-4">
              <Textarea
                id="skill-body"
                rows={14}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                aria-label="Skill instructions (markdown)"
                placeholder="Write the skill's instructions in markdown…"
                className="min-h-72 font-mono"
              />
            </TabsContent>
            <TabsContent value="preview" className="mt-4">
              <div className="min-h-72 rounded-lg border p-4 text-sm">
                {form.body.trim() ? (
                  <Streamdown>{form.body}</Streamdown>
                ) : (
                  <p className="text-muted-foreground text-sm">Nothing to preview yet.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Section title="Files" meta={`${skill.files.length} bundled`}>
        <SkillFileList files={skill.files} />
      </Section>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete skill?</DialogTitle>
            <DialogDescription>
              {usedBy > 0
                ? `${usedBy} ${usedBy === 1 ? "bot uses" : "bots use"} "${skill.name}" and will lose access. This can't be undone.`
                : `"${skill.name}" will be permanently deleted.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void remove()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
