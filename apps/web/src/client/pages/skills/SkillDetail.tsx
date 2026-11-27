import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Breadcrumbs } from "@groot/ui/breadcrumb";
import { Button } from "@groot/ui/button";
import { ErrorState } from "@groot/ui/empty-state";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { Section } from "@groot/shell/components/layout/Section";
import { useBotChoices } from "../../queries/bot-choices";
import { useSetSkill, useSkill, useSkillMutations } from "../../queries/skills";
import { SkillFileList } from "../../components/skills/SkillFileList";
import { DeleteSkillDialog } from "./detail/DeleteSkillDialog";
import { SkillBotsSection } from "./detail/SkillBotsSection";
import { SkillDetailsCard } from "./detail/SkillDetailsCard";
import { SkillInstructions } from "./detail/SkillInstructions";
import { LeaveGuard } from "../../components/LeaveGuard";
import { errorMessage } from "../../lib/errors";

export function SkillDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const resource = useSkill(id);
  const skill =
    resource.status === "ready"
      ? resource.data
      : resource.status === "failed"
        ? (resource.last ?? null)
        : null;
  const setSkill = useSetSkill(id);
  const mutations = useSkillMutations();
  const bots = useBotChoices().data ?? null;
  const [form, setForm] = useState({ description: "", body: "" });
  const [formFor, setFormFor] = useState<string | null>(null);
  if (skill && formFor !== id) {
    setFormFor(id);
    setForm({ description: skill.description, body: skill.body });
  }
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (resource.status === "failed") {
    return (
      <PageLayout title="Skill" maxWidth="4xl" backTo="/skills">
        <ErrorState
          title="Couldn't load skill"
          description={resource.loadError}
          action={
            <>
              <Button variant="outline" onClick={() => navigate("/skills")}>
                Back to skills
              </Button>
              <Button onClick={() => void resource.refresh()}>Retry</Button>
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
      const updated = await mutations.update.mutateAsync({
        id,
        input: { description: form.description.trim(), body: form.body },
      });
      setSkill(updated);
      setForm({ description: updated.description, body: updated.body });
      toast.success("Skill saved");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save skill"));
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
      setSkill(await mutations.update.mutateAsync({ id, input: { botIds } }));
    } catch (error) {
      setSkill((current) => ({ ...current, botIds: previous }));
      toast.error(errorMessage(error, "Failed to update bots"));
    }
  };

  const setAllBots = async (allBots: boolean) => {
    const previous = skill;
    setSkill({ ...skill, allBots });
    try {
      setSkill(await mutations.update.mutateAsync({ id, input: { allBots } }));
    } catch (error) {
      setSkill(previous);
      toast.error(errorMessage(error, "Failed to update bots"));
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await mutations.remove.mutateAsync(id);
      toast.success("Skill deleted");
      navigate("/skills");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete skill"));
      setDeleting(false);
    }
  };

  const usedBy = skill.botIds.length;

  const breadcrumb = (
    <Breadcrumbs page={skill.name}>
      <Link to="/skills">Skills</Link>
    </Breadcrumbs>
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
      <LeaveGuard when={dirty && !deleting} />
      <SkillDetailsCard skill={skill} form={form} setForm={setForm} />

      <SkillBotsSection
        skill={skill}
        bots={bots}
        usedBy={usedBy}
        toggleBot={toggleBot}
        setAllBots={setAllBots}
      />

      <SkillInstructions form={form} setForm={setForm} />

      <Section title="Files" meta={`${skill.files.length} bundled`}>
        <SkillFileList files={skill.files} />
      </Section>

      <DeleteSkillDialog
        skill={skill}
        usedBy={usedBy}
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        deleting={deleting}
        remove={remove}
      />
    </PageLayout>
  );
}
